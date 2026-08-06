import { createHash } from 'crypto';

const sharedChargesByReference = new Map();

// Implementação em memória do PaymentGateway (ver paymentGateway.js). Deixa
// o billing/payouts rodando de ponta a ponta (cobrança criada, boleto/pix
// simulado, repasse concluído) sem depender da Asaas estar homologada.
export class FakeGateway {
  constructor() {
    this.provider = 'FAKE';
    this.supportsIdempotentChargeCreation = true;
    this.supportsIdempotentTransfers = true;
    this.chargesByReference = sharedChargesByReference;
  }

  validateConfiguration() {}

  async ensureCustomer({ usuarioId }) {
    return { externalCustomerId: `fake_customer_${usuarioId}` };
  }

  async createCharge({
    valor,
    dataVencimento,
    externalReference,
    descricao,
    customerId,
  }) {
    const existing = this.chargesByReference.get(externalReference);

    if (existing) {
      if (
        Number(existing.rawJson.valor) !== Number(valor) ||
        existing.rawJson.dataVencimento !== dataVencimento
      ) {
        throw new Error(
          'A referência da cobrança já foi utilizada com valor ou vencimento diferente.'
        );
      }

      return existing;
    }

    // Determinístico inclusive depois de reiniciar o processo. Simula o
    // contrato de idempotência exigido dos adapters reais.
    const referenceHash = createHash('sha256')
      .update(externalReference)
      .digest('hex')
      .slice(0, 32);
    const externalPaymentId = `fake_pay_${referenceHash}`;

    const charge = {
      externalPaymentId,
      linhaDigitavel: '00190.00009 01234.567890 12345.678901 1 99990000100000',
      codigoBarras: '00199999900001000000001234567890123456789012',
      urlBoleto: `https://fake-gateway.local/boletos/${externalPaymentId}`,
      urlFatura: `https://fake-gateway.local/faturas/${externalPaymentId}`,
      qrCodePix: null,
      copiaColaPix: `00020126fakepix${externalPaymentId}5204000053039865802BR`,
      statusGateway: 'PENDING',
      rawJson: {
        externalReference,
        valor,
        dataVencimento,
        descricao,
        customerId,
      },
    };

    this.chargesByReference.set(externalReference, charge);

    return charge;
  }

  async cancelCharge(_externalPaymentId) {
    return { status: 'CANCELLED' };
  }

  async transfer({ valor, idempotencyKey }) {
    const transferHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex')
      .slice(0, 32);
    return {
      externalTransferId: `fake_transfer_${transferHash}`,
      status: 'DONE',
      valor,
    };
  }
}

export default new FakeGateway();
