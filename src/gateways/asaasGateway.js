import { toCents } from '../utils/money.js';

const DEFAULT_BASE_URL = 'https://api-sandbox.asaas.com/v3';
const DEFAULT_TIMEOUT_MS = 15000;

export const BEST_EFFORT_EXTERNAL_REFERENCE =
  'BEST_EFFORT_EXTERNAL_REFERENCE';

export class AsaasGatewayError extends Error {
  constructor(message, { statusCode, details } = {}) {
    super(message);
    this.name = 'AsaasGatewayError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function normalizedPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || undefined;
}

function apiErrorMessage(payload, fallback) {
  const descriptions = payload?.errors
    ?.map((error) => error?.description)
    .filter(Boolean);

  return descriptions?.length ? descriptions.join('; ') : fallback;
}

export class AsaasGateway {
  constructor({
    apiKey = process.env.ASAAS_API_KEY,
    baseUrl = process.env.ASAAS_API_URL || DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = Number(
      process.env.ASAAS_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS
    ),
    allowBestEffortChargeCreation =
      process.env.ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION === 'true',
  } = {}) {
    this.provider = 'ASAAS';
    // O POST /payments do Asaas não documenta uma chave idempotente nativa.
    // externalReference é apenas um campo de busca; portanto, a consulta
    // anterior/posterior ao POST reduz duplicidades, mas não garante exactly-once.
    this.supportsIdempotentChargeCreation = false;
    this.supportsIdempotentTransfers = false;
    this.chargeCreationSafetyMode = BEST_EFFORT_EXTERNAL_REFERENCE;
    this.allowBestEffortChargeCreation =
      allowBestEffortChargeCreation === true;
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  validateConfiguration() {
    if (!this.apiKey) {
      throw new AsaasGatewayError('ASAAS_API_KEY não configurada.');
    }

    if (typeof this.fetchImpl !== 'function') {
      throw new AsaasGatewayError('Cliente HTTP indisponível para o Asaas.');
    }
  }

  async _request(path, { method = 'GET', body } = {}) {
    this.validateConfiguration();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        access_token: this.apiKey,
        'content-type': 'application/json',
        'user-agent':
          process.env.ASAAS_USER_AGENT || 'TijucasImobiliaria/1.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new AsaasGatewayError(
        apiErrorMessage(payload, `Asaas respondeu HTTP ${response.status}.`),
        { statusCode: response.status, details: payload }
      );
    }

    return payload;
  }

  async _findUnique(resource, externalReference) {
    const params = new URLSearchParams({
      externalReference,
      limit: '2',
    });
    const payload = await this._request(`/${resource}?${params}`);
    const items = payload?.data ?? [];

    if (items.length > 1) {
      throw new AsaasGatewayError(
        `Mais de um registro Asaas usa a referência ${externalReference}.`
      );
    }

    return items[0] ?? null;
  }

  async ensureCustomer({ usuarioId, nome, documento, email, telefone }) {
    const externalReference = `usuario-${usuarioId}`;
    const existing = await this._findUnique(
      'customers',
      externalReference
    );

    if (existing) {
      return { externalCustomerId: existing.id };
    }

    const body = {
      name: nome,
      cpfCnpj: String(documento).replace(/\D/g, ''),
      email: email || undefined,
      mobilePhone: normalizedPhone(telefone),
      externalReference,
    };

    try {
      const created = await this._request('/customers', {
        method: 'POST',
        body,
      });

      return { externalCustomerId: created.id };
    } catch (error) {
      // Se a resposta do POST se perdeu depois de o Asaas persistir, a busca
      // por referência recupera o mesmo cliente no retry.
      const recovered = await this._findUnique(
        'customers',
        externalReference
      ).catch(() => null);

      if (recovered) {
        return { externalCustomerId: recovered.id };
      }

      throw error;
    }
  }

  _assertSameCharge(payment, input) {
    if (
      payment.customer !== input.customerId ||
      payment.dueDate !== input.dataVencimento ||
      toCents(payment.value) !== toCents(input.valor)
    ) {
      throw new AsaasGatewayError(
        'A referência externa já existe no Asaas com pagador, valor ou vencimento diferente.'
      );
    }
  }

  async _mapCharge(payment) {
    const identification = await this._request(
      `/payments/${encodeURIComponent(payment.id)}/identificationField`
    ).catch(() => null);
    const pix = await this._request(
      `/payments/${encodeURIComponent(payment.id)}/pixQrCode`
    ).catch(() => null);

    return {
      externalPaymentId: payment.id,
      linhaDigitavel: identification?.identificationField ?? null,
      codigoBarras: identification?.barCode ?? null,
      urlBoleto: payment.bankSlipUrl ?? null,
      urlFatura: payment.invoiceUrl ?? null,
      qrCodePix: pix?.encodedImage ?? null,
      copiaColaPix: pix?.payload ?? null,
      statusGateway: payment.status ?? 'PENDING',
      rawJson: { payment, identification, pix },
    };
  }

  async createCharge(input) {
    if (!this.allowBestEffortChargeCreation) {
      throw new AsaasGatewayError(
        'A criação de cobranças Asaas usa deduplicação best-effort por externalReference e está bloqueada. Libere-a explicitamente somente após a homologação.'
      );
    }

    if (!input.customerId) {
      throw new AsaasGatewayError(
        'O pagador Asaas é obrigatório para emitir a cobrança.'
      );
    }

    const existing = await this._findUnique(
      'payments',
      input.externalReference
    );

    if (existing) {
      this._assertSameCharge(existing, input);
      return this._mapCharge(existing);
    }

    try {
      const created = await this._request('/payments', {
        method: 'POST',
        body: {
          customer: input.customerId,
          billingType: input.billingType ?? 'BOLETO',
          value: input.valor,
          dueDate: input.dataVencimento,
          description: input.descricao,
          externalReference: input.externalReference,
        },
      });

      return this._mapCharge(created);
    } catch (error) {
      const recovered = await this._findUnique(
        'payments',
        input.externalReference
      ).catch(() => null);

      if (recovered) {
        this._assertSameCharge(recovered, input);
        return this._mapCharge(recovered);
      }

      throw error;
    }
  }

  async cancelCharge(externalPaymentId) {
    try {
      await this._request(`/payments/${encodeURIComponent(externalPaymentId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      // O cancelamento pode ter sido aceito pelo Asaas e a resposta ter se
      // perdido. Nesse retry, recurso ausente significa o resultado desejado.
      if (!(error instanceof AsaasGatewayError) || error.statusCode !== 404) {
        throw error;
      }
    }

    return { status: 'CANCELLED' };
  }

  async transfer() {
    throw new AsaasGatewayError(
      'Repasse Asaas ainda não homologado; use o fluxo manual auditado.'
    );
  }
}

export default new AsaasGateway();
