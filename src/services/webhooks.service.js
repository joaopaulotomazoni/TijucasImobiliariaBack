import { withTransaction } from '../utils/withTransaction.js';
import WebhooksRepository from '../repositories/webhooks.repository.js';
import BillingRepository from '../repositories/billing.repository.js';
import AppError from '../errors/AppError.js';
import GuaranteesRepository from '../repositories/guarantees.repository.js';
import { toCents } from '../utils/money.js';
import {
  resolverTransicaoStatus,
  statusDoRecebimento,
} from './webhooks.domain.js';

// PAYMENT_CONFIRMED reconhece o pagamento, mas ainda não representa saldo
// liquidado. Apenas PAYMENT_RECEIVED registra a entrada financeira.
const EVENTO_PARA_STATUS = {
  PAYMENT_CONFIRMED: 'CONFIRMADA',
  PAYMENT_RECEIVED: 'RECEBIDA',
  PAYMENT_REFUNDED: 'ESTORNADA',
  PAYMENT_CHARGEBACK_REQUESTED: 'ESTORNADA',
  PAYMENT_DELETED: 'CANCELADA',
};

// Esses eventos alteram a situação operacional no Asaas, mas não permitem
// inferir uma transição financeira local segura. O cancelamento abaixo é só
// do registro do boleto na CIP; um estorno parcial exige conciliar valores.
const EVENTO_SOMENTE_GATEWAY = new Map([
  [
    'PAYMENT_BANK_SLIP_CANCELLED',
    'registro_bancario_cancelado_requer_analise_operacional',
  ],
  [
    'PAYMENT_PARTIALLY_REFUNDED',
    'estorno_parcial_requer_conciliacao_de_valores',
  ],
]);

const STATUS_COM_COBRANCA_PAGAVEL = new Set([
  'ABERTA',
  'PENDENTE',
  'PARCIAL',
  'VENCIDA',
]);

function mapFormaPagamento(billingType) {
  if (billingType === 'PIX') return 'PIX';
  if (billingType === 'CREDIT_CARD') return 'CARTAO';
  return 'BOLETO';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function workerConfig() {
  return {
    maxTentativas: positiveInteger(process.env.WEBHOOK_MAX_ATTEMPTS, 8),
    backoffBaseSeconds: positiveInteger(
      process.env.WEBHOOK_BACKOFF_BASE_SECONDS,
      30
    ),
  };
}

function validarEnvelopeAsaas(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.id !== 'string' ||
    payload.id.trim() === '' ||
    typeof payload.event !== 'string' ||
    payload.event.trim() === ''
  ) {
    throw new AppError('Payload de webhook inválido.', 400);
  }
}

function mensagemDoErro(error) {
  const mensagem = error instanceof Error ? error.message : String(error);
  return mensagem.slice(0, 2000);
}

class WebhooksService {
  // A recepção faz somente uma escrita idempotente. Assim o endpoint pode
  // confirmar rapidamente ao Asaas sem atrelar a entrega à conciliação.
  async receberAsaas(payload) {
    validarEnvelopeAsaas(payload);

    return withTransaction(async (client) => {
      const evento = await WebhooksRepository.registrarEvento(client, {
        gateway: 'ASAAS',
        externalEventId: payload.id,
        eventType: payload.event,
        payload,
      });

      if (!evento) {
        throw new Error('Falha ao localizar evento idempotente recém recebido.');
      }

      return {
        eventoId: evento.id,
        duplicado: !evento.novo,
        status: evento.status,
      };
    });
  }

  // Mantido como atalho compatível para chamadas internas/testes. A rota
  // HTTP usa receberAsaas e dispara o processamento sem aguardá-lo.
  async processarAsaas(payload) {
    const recebido = await this.receberAsaas(payload);

    if (recebido.duplicado && !['RECEBIDO', 'ERRO'].includes(recebido.status)) {
      return { ignorado: true, motivo: 'evento_ja_processado' };
    }

    const processado = await this.processarEventoPorId(recebido.eventoId);
    return processado ?? {
      ignorado: true,
      motivo: recebido.duplicado
        ? 'evento_aguardando_retry_ou_em_processamento'
        : 'evento_em_processamento',
    };
  }

  async processarEventoPorId(eventoId) {
    return this.#processarUm(eventoId);
  }

  async processarPendentes({ limite = 50 } = {}) {
    const limiteSeguro = Math.min(positiveInteger(limite, 50), 500);
    const resultados = [];

    for (let index = 0; index < limiteSeguro; index += 1) {
      const resultado = await this.#processarUm();
      if (!resultado) break;
      resultados.push(resultado);
    }

    return {
      total: resultados.length,
      processados: resultados.filter((item) => item.statusInbox === 'PROCESSADO').length,
      ignorados: resultados.filter((item) => item.statusInbox === 'IGNORADO').length,
      erros: resultados.filter((item) => item.statusInbox === 'ERRO').length,
      descartados: resultados.filter((item) => item.statusInbox === 'DESCARTADO').length,
      resultados,
    };
  }

  async #processarUm(eventoId = null) {
    const { maxTentativas, backoffBaseSeconds } = workerConfig();

    return withTransaction(async (client) => {
      const evento = await WebhooksRepository.buscarParaProcessar(client, {
        eventoId,
        maxTentativas,
      });

      if (!evento) return null;

      await client.query('SAVEPOINT webhook_business');

      try {
        const resultado = await this.#aplicarEvento(client, evento);
        await client.query('RELEASE SAVEPOINT webhook_business');

        const statusInbox = resultado.ignorado ? 'IGNORADO' : 'PROCESSADO';
        await WebhooksRepository.marcarConcluido(
          client,
          evento.id,
          statusInbox,
          resultado.ignorado ? resultado.motivo : null
        );

        return { ...resultado, eventoId: evento.id, statusInbox };
      } catch (error) {
        // Desfaz apenas as mutações financeiras. A linha da inbox e o
        // diagnóstico da tentativa permanecem e são confirmados no COMMIT.
        await client.query('ROLLBACK TO SAVEPOINT webhook_business');
        await client.query('RELEASE SAVEPOINT webhook_business');

        const expoente = Math.min(Number(evento.tentativas), 10);
        const backoffSeconds = Math.min(
          backoffBaseSeconds * (2 ** expoente),
          3600
        );
        const falha = await WebhooksRepository.marcarFalha(client, {
          id: evento.id,
          mensagem: mensagemDoErro(error),
          maxTentativas,
          backoffSeconds,
        });

        return {
          eventoId: evento.id,
          erro: true,
          mensagem: mensagemDoErro(error),
          statusInbox: falha?.status ?? 'ERRO',
          tentativas: falha?.tentativas,
        };
      }
    });
  }

  async #aplicarEvento(client, eventoInbox) {
    const payload = eventoInbox.payload_json;
    const { event, payment } = payload ?? {};
    const novoStatusMapeado = EVENTO_PARA_STATUS[event];
    const motivoSomenteGateway = EVENTO_SOMENTE_GATEWAY.get(event);

    if (!novoStatusMapeado && !motivoSomenteGateway) {
      return { ignorado: true, motivo: 'evento_nao_mapeado' };
    }

    if (!payment || typeof payment.id !== 'string' || payment.id.trim() === '') {
      throw new AppError('Evento financeiro sem payment.id.', 422);
    }

    const caucao = String(payment.externalReference ?? '').startsWith('caucao-')
      ? await GuaranteesRepository.getCaucaoByExternalId(client, payment.id)
      : null;
    if (caucao) {
      if (
        ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event) &&
        toCents(payment.value) !== toCents(caucao.valor)
      ) {
        throw new AppError(
          'O valor recebido da caução diverge da cobrança registrada.',
          422
        );
      }
      await GuaranteesRepository.applyCaucaoGatewayEvent(
        client,
        caucao,
        event,
        payment.status ?? event
      );
      return {
        garantiaId: caucao.garantia_id,
        status: event === 'PAYMENT_RECEIVED'
          ? 'PAGO'
          : event === 'PAYMENT_CONFIRMED'
            ? 'EM_ANALISE'
            : caucao.status_pagamento,
      };
    }

    const cobranca = await BillingRepository.getGatewayCobrancaPorExternalId(
      client,
      payment.id
    );

    if (!cobranca) {
      if (String(payment.externalReference ?? '').startsWith('contrato-')) {
        throw new AppError(
          'Cobrança local ainda não disponível para conciliação.',
          503
        );
      }

      return { ignorado: true, motivo: 'cobranca_nao_encontrada' };
    }

    if (motivoSomenteGateway) {
      await BillingRepository.atualizarStatusGateway(
        client,
        payment.id,
        event
      );

      // Um estorno parcial só existe depois de alguma liquidação. Mesmo se o
      // evento de recebimento estiver atrasado, não se pode oferecer a mesma
      // cobrança novamente enquanto a conciliação manual está pendente.
      if (event === 'PAYMENT_PARTIALLY_REFUNDED') {
        await BillingRepository.atualizarAtividadeCobranca(
          client,
          payment.id,
          false
        );
      }

      return {
        parcelaId: cobranca.parcela_id,
        status: cobranca.status,
        ignorado: true,
        motivo: motivoSomenteGateway,
      };
    }

    let novoStatus = novoStatusMapeado;
    let valorRecebido;

    if (event === 'PAYMENT_RECEIVED') {
      if (payment.value === undefined || payment.value === null) {
        throw new AppError('Evento PAYMENT_RECEIVED sem payment.value.', 422);
      }

      valorRecebido = payment.value;
      const totalAnterior = await BillingRepository.getTotalPagamentosAtivos(
        client,
        cobranca.parcela_id
      );
      novoStatus = statusDoRecebimento(
        Number(totalAnterior) + Number(valorRecebido),
        cobranca.valor_total
      );
    }

    const statusAplicado = resolverTransicaoStatus(cobranca.status, novoStatus);

    // Não deixa um evento atrasado rebaixar nem mesmo o status espelhado do
    // gateway. PAYMENT_DELETED usa o nome do evento, pois payment.status pode
    // ainda chegar como PENDING no mesmo envelope.
    const transicaoAtrasada =
      statusAplicado === cobranca.status &&
      novoStatusMapeado !== cobranca.status;

    if (!transicaoAtrasada || event === 'PAYMENT_DELETED') {
      await BillingRepository.atualizarStatusGateway(
        client,
        payment.id,
        event === 'PAYMENT_DELETED' ? event : payment.status ?? event
      );
    }

    if (statusAplicado !== cobranca.status) {
      await BillingRepository.atualizarStatusParcela(
        client,
        cobranca.parcela_id,
        statusAplicado
      );
    }

    await BillingRepository.atualizarAtividadeCobranca(
      client,
      payment.id,
      event !== 'PAYMENT_DELETED' &&
        STATUS_COM_COBRANCA_PAGAVEL.has(statusAplicado)
    );

    if (
      event === 'PAYMENT_RECEIVED' &&
      ['PARCIAL', 'RECEBIDA'].includes(statusAplicado) &&
      !['RECEBIDA', 'REPASSADA', 'PAGA'].includes(cobranca.status)
    ) {
      await BillingRepository.registrarPagamentoGateway(client, {
        parcelaId: cobranca.parcela_id,
        valorPago: valorRecebido,
        dataPagamento:
          payment.paymentDate ?? new Date().toISOString().slice(0, 10),
        formaPagamento: mapFormaPagamento(payment.billingType),
        // Este identificador precisa continuar reconhecível fora da tabela
        // local e idempotente entre reentregas do gateway.
        gatewayEventId: eventoInbox.external_event_id,
      });
    }

    if (statusAplicado === 'ESTORNADA') {
      await BillingRepository.estornarPagamentosGateway(
        client,
        cobranca.parcela_id
      );
    }

    return { parcelaId: cobranca.parcela_id, status: statusAplicado };
  }
}

export default new WebhooksService();
