import ContractsRepository from '../repositories/contracts.repository.js';
import AppError from '../errors/AppError.js';
import BillingService from './billing.service.js';
import { dataAtualIso } from '../utils/businessDays.js';
import { normalizePositiveBigintId } from '../utils/ids.js';
import StorageService from './storage.service.js';

class ContractsService {
  async getContracts() {
    return await ContractsRepository.getContracts();
  }

  async getContractById(id) {
    const normalizedId = normalizePositiveBigintId(
      id,
      'O ID do contrato'
    );

    const contract = await ContractsRepository.getContractById(normalizedId);

    if (!contract) {
      throw new AppError('Contrato não encontrado.', 404);
    }

    return contract;
  }

  async registerContract(contractData) {
    this.assertReajusteLegal(contractData.periodicidadeReajusteMeses);
    this.assertInquilinos(contractData.inquilinos);
    // Falha antes de persistir o contrato quando o provider configurado nem
    // sequer possui adapter registrado. Falhas externas durante o lote são
    // devolvidas de forma explícita e podem ser retomadas pelo endpoint batch.
    BillingService.assertGatewayConfigured();

    const hoje = dataAtualIso();
    const cobrancasIniciaisAPartirDe =
      contractData.dataInicio > hoje ? contractData.dataInicio : hoje;
    const contrato = await ContractsRepository.registerContract({
      ...contractData,
      cobrancasIniciaisAPartirDe,
    });
    let cobrancas;
    try {
      cobrancas = await BillingService.gerarCobrancasDoContrato(
        contrato.id,
        {
          aPartirDe: cobrancasIniciaisAPartirDe,
          marcarInicial: true,
        }
      );
    } catch (error) {
      // O contrato já foi confirmado no banco. Devolve um resultado parcial
      // explícito para a UI preservar o registro e oferecer reprocessamento.
      cobrancas = {
        solicitadas: 0,
        geradas: 0,
        existentes: 0,
        completo: false,
        itens: [],
        falhas: [{
          contratoId: contrato.id,
          competencia: null,
          motivo: error.message,
        }],
      };
    }

    return { contrato, cobrancas };
  }

  async registerHistoricalPayments(id, pagamentos, registradoPor) {
    const normalizedId = normalizePositiveBigintId(id, 'O ID do contrato');
    const normalizedUserId = normalizePositiveBigintId(
      registradoPor,
      'O ID do usuário responsável'
    );
    const today = dataAtualIso();
    for (const pagamento of pagamentos) {
      if (pagamento.competencia > today || pagamento.dataPagamento > today) {
        throw new AppError(
          'Pagamentos de migração devem possuir competência e pagamento no passado.',
          400
        );
      }
      if (pagamento.comprovanteKey) {
        StorageService.assertKeyBelongsToUser(
          pagamento.comprovanteKey,
          normalizedUserId,
          ['COMPROVANTE_PAGAMENTO']
        );
        await StorageService.assertUploadedObject(pagamento.comprovanteKey);
      }
    }
    return ContractsRepository.registerHistoricalPayments(
      normalizedId,
      pagamentos,
      normalizedUserId
    );
  }

  async updateContract(id, contractData) {
    const normalizedId = normalizePositiveBigintId(
      id,
      'O ID do contrato'
    );

    this.assertReajusteLegal(contractData.periodicidadeReajusteMeses);
    if (contractData.inquilinos !== undefined) {
      this.assertInquilinos(contractData.inquilinos);
    }

    return await ContractsRepository.updateContract(normalizedId, contractData);
  }

  async deleteContract(id) {
    const normalizedId = normalizePositiveBigintId(
      id,
      'O ID do contrato'
    );

    return await ContractsRepository.deleteContract(normalizedId);
  }

  // Lei 10.192/2001: reajuste com periodicidade mínima anual. Espelha o CHECK
  // do banco (contratos_reajuste_chk) com uma mensagem amigável.
  assertReajusteLegal(periodicidadeReajusteMeses) {
    if (
      periodicidadeReajusteMeses !== undefined &&
      periodicidadeReajusteMeses < 12
    ) {
      throw new AppError(
        'A periodicidade de reajuste não pode ser inferior a 12 meses (Lei 10.192/2001).',
        400
      );
    }
  }

  assertInquilinos(inquilinos) {
    const ids = inquilinos?.map((inquilino) => String(inquilino.usuarioId));

    if (!ids?.length) {
      throw new AppError('Informe ao menos um inquilino.', 400);
    }

    if (new Set(ids).size !== ids.length) {
      throw new AppError(
        'Um inquilino não pode ser vinculado duas vezes ao contrato.',
        400
      );
    }

    if (inquilinos.filter((inquilino) => inquilino.principal).length !== 1) {
      throw new AppError('Informe exatamente um inquilino principal.', 400);
    }
  }
}

export default new ContractsService();
