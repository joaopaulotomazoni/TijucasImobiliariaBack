import BillingRepository from '../repositories/billing.repository.js';
import gatewayFactory from '../gateways/gatewayFactory.js';
import AppError from '../errors/AppError.js';
import { withTransactionClient } from '../utils/withTransaction.js';
import { isValidIsoDate } from '../utils/isoDate.js';
import {
  calcularComissao,
  montarLancamentos,
  calcularValorCobranca,
} from './billing.domain.js';
import { montarAgendaCobrancas } from './billingSchedule.js';
import { normalizePositiveBigintId } from '../utils/ids.js';
import { dataAtualIso } from '../utils/businessDays.js';
import StorageService from './storage.service.js';
import { toCents } from '../utils/money.js';

const BEST_EFFORT_EXTERNAL_REFERENCE =
  'BEST_EFFORT_EXTERNAL_REFERENCE';

class BillingService {
  assertGatewayConfigured() {
    const gateway = gatewayFactory.resolve();

    const aceitaCriacaoBestEffort =
      gateway.chargeCreationSafetyMode ===
        BEST_EFFORT_EXTERNAL_REFERENCE &&
      gateway.allowBestEffortChargeCreation === true;

    if (
      gateway.supportsIdempotentChargeCreation !== true &&
      !aceitaCriacaoBestEffort
    ) {
      if (
        gateway.chargeCreationSafetyMode ===
        BEST_EFFORT_EXTERNAL_REFERENCE
      ) {
        throw new AppError(
          'A criação de cobranças Asaas não possui idempotência nativa e está bloqueada. Após homologar o risco de retry no Sandbox, defina ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=true.',
          500
        );
      }

      throw new AppError(
        'O gateway configurado não garante criação idempotente de cobranças.',
        500
      );
    }

    if (typeof gateway.ensureCustomer !== 'function') {
      throw new AppError(
        'O gateway configurado não implementa cadastro de pagador.',
        500
      );
    }

    gateway.validateConfiguration?.();

    return gateway;
  }

  async gerarCobranca(
    contratoId,
    { competencia, dataVencimento, descricao }
  ) {
    const normalizedContratoId = normalizePositiveBigintId(
      contratoId,
      'O ID do contrato'
    );

    return BillingRepository.withContratoBillingLock(
      normalizedContratoId,
      (client) =>
        this._gerarCobrancaComLock(
          client,
          normalizedContratoId,
          { competencia, dataVencimento, descricao }
        )
    );
  }

  async _gerarCobrancaComLock(
    client,
    contratoId,
    { competencia, dataVencimento, descricao },
    { ignorarExistente = false, contratoCobranca } = {}
  ) {
    return withTransactionClient(client, async (transactionClient) => {
      const contratoAtual = await BillingRepository.getContratoParaCobranca(
        contratoId,
        transactionClient
      );
      const contrato = contratoCobranca ?? contratoAtual;

      this._assertContratoPodeGerarCobranca(contratoAtual);
      this._assertPeriodoDaCobranca(contratoAtual, {
        competencia,
        dataVencimento,
      });

      const jaExiste = await BillingRepository.parcelaJaExiste(
        contratoId,
        competencia,
        transactionClient
      );

      if (jaExiste) {
        if (ignorarExistente) {
          return { existente: true, competencia, dataVencimento };
        }

        throw new AppError(
          'Já existe cobrança gerada para esta competência.',
          409
        );
      }

      const comissao = calcularComissao(contrato);
      const lancamentos = montarLancamentos({
        valorCondominio: contrato.valor_condominio ?? 0,
        valorIptu: contrato.valor_iptu ?? 0,
        comissao,
      });
      const valorCobranca = calcularValorCobranca({
        valorBase: contrato.valor_aluguel,
        lancamentos,
      });

      if (!Number.isFinite(valorCobranca) || valorCobranca <= 0) {
        throw new AppError(
          'O valor calculado para a cobrança é zero, negativo ou inválido.',
          409
        );
      }

      // Esta chave canônica é também a chave idempotente obrigatória do
      // adapter. Se a rede cair depois da emissão, o retry recupera/reutiliza
      // a mesma cobrança externa em vez de criar outra.
      const externalReference = `contrato-${contratoId}-${competencia}`;
      const gateway = this.assertGatewayConfigured();
      const customerId = await BillingRepository.getOrCreateGatewayCustomer(
        transactionClient,
        {
          usuarioId: contrato.pagador_usuario_id,
          gateway: gateway.provider,
          createExternalCustomer: async () => {
            const customer = await gateway.ensureCustomer({
              usuarioId: contrato.pagador_usuario_id,
              nome: contrato.pagador_nome,
              documento: contrato.pagador_documento,
              email: contrato.pagador_email,
              telefone: contrato.pagador_telefone,
            });

            return customer?.externalCustomerId;
          },
        }
      );
      const cobranca = await gateway.createCharge({
        valor: valorCobranca,
        dataVencimento,
        externalReference,
        idempotencyKey: externalReference,
        customerId,
        descricao:
          descricao ?? `Aluguel ${competencia} — contrato #${contratoId}`,
      });

      if (!cobranca?.externalPaymentId) {
        throw new AppError(
          'O gateway não retornou a identificação da cobrança.',
          502
        );
      }

      const parcela = await BillingRepository.criarParcelaComCobranca(
        {
          contratoId,
          competencia,
          dataVencimento,
          valorBase: contrato.valor_aluguel,
          lancamentos,
          externalReference,
          cobranca: {
            ...cobranca,
            gateway: gateway.provider,
            valor: valorCobranca,
          },
        },
        transactionClient
      );

      return { ...parcela, existente: false };
    });
  }

  async gerarCobrancasDoContrato(
    contratoId,
    { aPartirDe, marcarInicial } = {}
  ) {
    const normalizedContratoId = normalizePositiveBigintId(
      contratoId,
      'O ID do contrato'
    );

    if (aPartirDe !== undefined && !isValidIsoDate(aPartirDe)) {
      throw new AppError(
        'A data inicial deve ser válida e estar no formato AAAA-MM-DD.',
        400
      );
    }

    return BillingRepository.withContratoBillingLock(
      normalizedContratoId,
      async (client) => {
        const contrato = await BillingRepository.getContratoParaCobranca(
          normalizedContratoId,
          client
        );

        this._assertContratoPodeGerarCobranca(contrato, true);

        const retomandoLoteInicial =
          aPartirDe === undefined &&
          !contrato.cobrancas_iniciais_concluidas_em;
        const dataInicialEfetiva =
          aPartirDe ??
          (retomandoLoteInicial
            ? contrato.cobrancas_iniciais_a_partir_de
            : dataAtualIso());
        const marcarInicialEfetivo =
          marcarInicial ?? retomandoLoteInicial;

        const agenda = montarAgendaCobrancas({
          dataInicio: contrato.data_inicio,
          dataFim: contrato.data_fim,
          diaVencimento: contrato.dia_vencimento,
          aPartirDe: dataInicialEfetiva,
        });
        const resultado = {
          solicitadas: agenda.length,
          geradas: 0,
          existentes: 0,
          falhas: [],
          itens: [],
        };

        for (const item of agenda) {
          try {
            const parcela = await this._gerarCobrancaComLock(
              client,
              normalizedContratoId,
              item,
              {
                ignorarExistente: true,
                // Condomínio/IPTU são do imóvel e podem ser editados por outra
                // tela. O snapshot mantém as 12 cobranças do mesmo lote com a
                // mesma composição financeira.
                contratoCobranca: contrato,
              }
            );

            if (parcela.existente) {
              resultado.existentes += 1;
            } else {
              resultado.geradas += 1;
            }

            resultado.itens.push(parcela);
          } catch (error) {
            resultado.falhas.push({
              contratoId: normalizedContratoId,
              competencia: item.competencia,
              dataVencimento: item.dataVencimento,
              motivo: error.message,
            });
          }
        }

        const resposta = {
          ...resultado,
          completo:
            resultado.falhas.length === 0 &&
            resultado.geradas + resultado.existentes ===
              resultado.solicitadas,
        };

        if (marcarInicialEfetivo && resposta.completo) {
          await BillingRepository.marcarCobrancasIniciaisConcluidas(
            normalizedContratoId,
            client
          );
        }

        return resposta;
      }
    );
  }

  // Mantém, diariamente, uma janela móvel de até 12 vencimentos. Isso cobre
  // antecedência entre meses, repõe competências futuras ausentes e continua
  // o fluxo de contratos com duração maior do que um ano.
  async reconciliarHorizonteCobrancas(hoje) {
    if (!isValidIsoDate(hoje)) {
      throw new AppError('Data de reconciliação inválida.', 400);
    }

    const contratos =
      await BillingRepository.getContratosAtivosParaReconciliacao();
    const resultados = {
      contratosProcessados: 0,
      geradas: 0,
      existentes: 0,
      falhas: [],
    };

    for (const contrato of contratos) {
      try {
        const loteInicialPendente =
          !contrato.cobrancas_iniciais_concluidas_em;
        const lote = await this.gerarCobrancasDoContrato(contrato.id, {
          aPartirDe: loteInicialPendente
            ? contrato.cobrancas_iniciais_a_partir_de
            : hoje,
          marcarInicial: loteInicialPendente,
        });
        resultados.contratosProcessados += 1;
        resultados.geradas += lote.geradas;
        resultados.existentes += lote.existentes;
        resultados.falhas.push(...lote.falhas);
      } catch (error) {
        resultados.falhas.push({
          contratoId: contrato.id,
          motivo: error.message,
        });
      }
    }

    return resultados;
  }

  async listarCobrancas(filtros) {
    return BillingRepository.listarParcelas(filtros);
  }

  async detalharCobranca(parcelaId) {
    const normalizedParcelaId = normalizePositiveBigintId(
      parcelaId,
      'O ID da parcela'
    );
    const parcela = await BillingRepository.getParcelaDetalhe(
      normalizedParcelaId
    );

    if (!parcela) {
      throw new AppError('Parcela não encontrada.', 404);
    }

    return parcela;
  }

  // Reexibe a cobrança ativa — nunca cria uma nova no gateway, o que
  // duplicaria o valor a receber.
  async segundaVia(parcelaId) {
    const normalizedParcelaId = normalizePositiveBigintId(
      parcelaId,
      'O ID da parcela'
    );
    const cobranca = await BillingRepository.getCobrancaAtiva(
      normalizedParcelaId
    );

    if (!cobranca) {
      throw new AppError('Não há cobrança ativa para esta parcela.', 404);
    }

    return {
      id: cobranca.id,
      gateway: cobranca.gateway,
      externalPaymentId: cobranca.external_payment_id,
      linhaDigitavel: cobranca.linha_digitavel,
      codigoBarras: cobranca.codigo_barras,
      urlBoleto: cobranca.url_boleto,
      urlFatura: cobranca.url_fatura,
      qrCodePix: cobranca.qr_code_pix,
      copiaColaPix: cobranca.copia_cola_pix,
      valor: Number(cobranca.valor),
      dataVencimento: cobranca.data_vencimento,
      statusGateway: cobranca.status_gateway,
    };
  }

  async cancelarCobranca(parcelaId) {
    const normalizedParcelaId = normalizePositiveBigintId(
      parcelaId,
      'O ID da parcela'
    );
    const cobranca = await BillingRepository.getCobrancaAtiva(
      normalizedParcelaId
    );

    if (!cobranca) {
      throw new AppError('Não há cobrança ativa para esta parcela.', 404);
    }

    const gateway = gatewayFactory.resolve(cobranca.gateway);
    await gateway.cancelCharge(cobranca.external_payment_id);

    return BillingRepository.cancelarCobrancaAtiva(normalizedParcelaId);
  }

  async cancelarCobrancasDoContrato(contratoId) {
    const id = normalizePositiveBigintId(contratoId, 'O ID do contrato');
    return BillingRepository.withContratoBillingLock(id, async (client) => {
      const contract = await BillingRepository.getContratoParaCobranca(id, client);
      if (!contract) throw new AppError('Contrato não encontrado.', 404);
      const charges =
        await BillingRepository.listarCobrancasAtivasDoContrato(id, client);
      const result = { solicitadas: charges.length, canceladas: 0, falhas: [] };
      for (const charge of charges) {
        try {
          if (['CONFIRMADA', 'RECEBIDA', 'PAGA', 'REPASSADA', 'ESTORNADA'].includes(charge.status)) {
            throw new AppError('A parcela já possui movimentação financeira.', 409);
          }
          const gateway = gatewayFactory.resolve(charge.gateway);
          await gateway.cancelCharge(charge.external_payment_id);
          await BillingRepository.cancelarCobrancaAtiva(charge.parcela_id);
          result.canceladas += 1;
        } catch (error) {
          result.falhas.push({
            parcelaId: charge.parcela_id,
            motivo: error.message,
          });
        }
      }
      return { ...result, completo: result.falhas.length === 0 };
    });
  }

  async registrarBaixaManual(parcelaId, data, usuarioId) {
    const normalizedParcelaId = normalizePositiveBigintId(
      parcelaId,
      'O ID da parcela'
    );
    const normalizedUsuarioId = normalizePositiveBigintId(
      usuarioId,
      'O ID do usuário responsável'
    );
    const initial = await BillingRepository.getContextoBaixaManual(
      normalizedParcelaId
    );
    if (!initial) throw new AppError('Parcela não encontrada.', 404);

    return BillingRepository.withContratoBillingLock(
      initial.contrato_id,
      async (client) => {
        const context = await BillingRepository.getContextoBaixaManual(
          normalizedParcelaId,
          client
        );
        if (context.baixa_status === 'CONCLUIDA') {
          return { id: context.baixa_id, status: 'CONCLUIDA', idempotente: true };
        }
        if (!context.gateway_cobranca_id || (!context.ativa && context.baixa_status !== 'GATEWAY_CANCELADO')) {
          throw new AppError(
            'Esta parcela não possui boleto ativo. Para contrato migrado, use o pagamento histórico.',
            409
          );
        }
        if (['CONFIRMADA', 'RECEBIDA', 'PAGA', 'REPASSADA', 'ESTORNADA'].includes(context.parcela_status)) {
          throw new AppError('Esta parcela não aceita baixa presencial.', 409);
        }

        const valorPago = data.valorPago ?? Number(context.valor_total);
        if (toCents(valorPago) !== toCents(context.valor_total)) {
          throw new AppError('A baixa integral deve usar o valor total da parcela.', 400);
        }
        if (data.comprovanteKey) {
          StorageService.assertKeyBelongsToUser(
            data.comprovanteKey,
            normalizedUsuarioId,
            ['COMPROVANTE_PAGAMENTO']
          );
          await StorageService.assertUploadedObject(data.comprovanteKey);
        }

        const baixa = await BillingRepository.iniciarBaixaManual(client, {
          ...data,
          parcelaId: normalizedParcelaId,
          gatewayCobrancaId: context.gateway_cobranca_id,
          solicitadoPor: normalizedUsuarioId,
          valorPago,
        });

        if (baixa.status !== 'GATEWAY_CANCELADO') {
          try {
            const gateway = gatewayFactory.resolve(context.gateway);
            await gateway.cancelCharge(context.external_payment_id);
            await BillingRepository.marcarBaixaGatewayCancelado(client, baixa.id);
          } catch (error) {
            await BillingRepository.marcarFalhaBaixaManual(client, baixa.id, error.message);
            throw new AppError(
              `Não foi possível cancelar o boleto no gateway: ${error.message}`,
              502
            );
          }
        }

        return withTransactionClient(client, (transactionClient) =>
          BillingRepository.finalizarBaixaManual(transactionClient, baixa.id)
        );
      }
    );
  }

  _assertContratoPodeGerarCobranca(contrato, lote = false) {
    if (!contrato) {
      throw new AppError('Contrato não encontrado.', 404);
    }

    if (!['ATIVO', 'INADIMPLENTE'].includes(contrato.status)) {
      throw new AppError(
        lote
          ? 'Só é possível gerar cobranças em lote para contratos vigentes.'
          : 'Só é possível gerar cobrança para contratos vigentes.',
        409
      );
    }

    if (!contrato.proprietario_id) {
      throw new AppError(
        'O imóvel deste contrato não tem proprietário definido.',
        409
      );
    }

    if (!contrato.pagador_usuario_id) {
      throw new AppError(
        'O contrato precisa ter um inquilino principal para emitir boletos.',
        409
      );
    }
  }

  _assertPeriodoDaCobranca(contrato, { competencia, dataVencimento }) {
    if (!isValidIsoDate(competencia) || !competencia.endsWith('-01')) {
      throw new AppError(
        'A competência deve ser o primeiro dia de um mês válido (AAAA-MM-01).',
        400
      );
    }

    if (!isValidIsoDate(dataVencimento)) {
      throw new AppError(
        'A data de vencimento deve ser uma data válida.',
        400
      );
    }

    if (competencia.slice(0, 7) !== dataVencimento.slice(0, 7)) {
      throw new AppError(
        'A competência e o vencimento devem pertencer ao mesmo mês.',
        400
      );
    }

    if (
      dataVencimento < contrato.data_inicio ||
      dataVencimento > contrato.data_fim
    ) {
      throw new AppError(
        'O vencimento deve estar dentro da vigência do contrato.',
        409
      );
    }

    const diaVencimento = Number(dataVencimento.slice(8, 10));

    if (diaVencimento !== Number(contrato.dia_vencimento)) {
      throw new AppError(
        `O vencimento deste contrato deve ocorrer no dia ${contrato.dia_vencimento}.`,
        400
      );
    }
  }
}

export default new BillingService();
