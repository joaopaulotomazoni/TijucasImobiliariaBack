import ContractsRepository from '../repositories/contracts.repository.js';
import AppError from '../errors/AppError.js';

class ContractsService {
  async getContracts() {
    return await ContractsRepository.getContracts();
  }

  async getContractById(id) {
    if (!id) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    const contract = await ContractsRepository.getContractById(id);

    if (!contract) {
      throw new AppError('Contrato não encontrado.', 404);
    }

    return contract;
  }

  async registerContract(contractData) {
    this.assertReajusteLegal(contractData.periodicidadeReajusteMeses);

    return await ContractsRepository.registerContract(contractData);
  }

  async updateContract(id, contractData) {
    if (!id) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    this.assertReajusteLegal(contractData.periodicidadeReajusteMeses);

    return await ContractsRepository.updateContract(id, contractData);
  }

  async deleteContract(id) {
    if (!id) {
      throw new AppError('O ID do contrato é obrigatório.', 400);
    }

    return await ContractsRepository.deleteContract(id);
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
}

export default new ContractsService();
