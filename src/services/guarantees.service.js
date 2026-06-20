import GuaranteesRepository from '../repositories/guarantees.repository.js';
import ContractsRepository from '../repositories/contracts.repository.js';
import AppError from '../errors/AppError.js';

class GuaranteesService {
  async getGuaranteesByContract(contratoId) {
    if (!contratoId) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    return await GuaranteesRepository.getGuaranteesByContract(contratoId);
  }

  async createGuarantee(contratoId, guaranteeData) {
    if (!contratoId) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    await this.assertBusinessRules(contratoId, guaranteeData);

    return await GuaranteesRepository.createGuarantee(contratoId, guaranteeData);
  }

  async substituteGuarantee(garantiaId, motivo, guaranteeData) {
    if (!garantiaId) {
      throw new AppError('O ID da garantia é obrigatório.', 400);
    }

    const contratoId =
      await GuaranteesRepository.getContractIdByGuarantee(garantiaId);

    if (!contratoId) {
      throw new AppError('Garantia não encontrada.', 404);
    }

    await this.assertBusinessRules(contratoId, guaranteeData);

    return await GuaranteesRepository.substituteGuarantee(
      garantiaId,
      motivo,
      guaranteeData
    );
  }

  async registerCaucaoDevolucao(garantiaId, devolucaoData) {
    if (!garantiaId) {
      throw new AppError('O ID da garantia é obrigatório.', 400);
    }

    return await GuaranteesRepository.registerCaucaoDevolucao(
      garantiaId,
      devolucaoData
    );
  }

  async exonerarFiador(garantiaId, usuarioId, exoneracaoData) {
    if (!garantiaId || !usuarioId) {
      throw new AppError(
        'O ID da garantia e do fiador são obrigatórios.',
        400
      );
    }

    return await GuaranteesRepository.exonerarFiador(
      garantiaId,
      usuarioId,
      exoneracaoData
    );
  }

  // Regras que dependem de dados do contrato — validadas aqui com mensagem
  // amigável. O banco (trigger + CHECK) é a rede de segurança final.
  async assertBusinessRules(contratoId, guaranteeData) {
    if (guaranteeData.tipo === 'CAUCAO' && guaranteeData.modalidade === 'DINHEIRO') {
      const contract = await ContractsRepository.getContractById(contratoId);

      if (contract && guaranteeData.valor > 3 * Number(contract.valor_aluguel)) {
        throw new AppError(
          `A caução em dinheiro não pode exceder 3 aluguéis (Lei 8.245/91, art. 38, §2º). Máximo permitido: ${
            3 * Number(contract.valor_aluguel)
          }.`,
          400
        );
      }
    }

    if (guaranteeData.tipo === 'FIADOR') {
      for (const fiador of guaranteeData.fiadores) {
        // CC art. 1.647, III: fiança de pessoa casada exige outorga conjugal,
        // salvo no regime de separação absoluta.
        if (
          fiador.estadoCivil === 'CASADO' &&
          fiador.regimeBens !== 'SEPARACAO_ABSOLUTA' &&
          !fiador.outorgaConjugal
        ) {
          throw new AppError(
            'A fiança prestada por pessoa casada exige a outorga do cônjuge (Código Civil, art. 1.647, III).',
            400
          );
        }
      }
    }
  }
}

export default new GuaranteesService();
