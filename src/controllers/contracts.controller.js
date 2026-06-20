import { z } from 'zod';
import ContractsServices from '../services/contracts.service.js';
import { toNumber } from '../utils/zodHelpers.js';

const inquilinoSchema = z.object({
  usuarioId: z.number({
    required_error: 'O ID do inquilino é obrigatório.',
    invalid_type_error: 'O ID do inquilino deve ser um número.',
  }),
  principal: z.boolean().optional(),
});

const baseContractShape = {
  imovelId: z.number({
    required_error: 'O imóvel é obrigatório.',
    invalid_type_error: 'O imóvel é obrigatório.',
  }),
  corretorId: z.number().optional(),
  dataInicio: z
    .string({ required_error: 'A data de início é obrigatória.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'A data de início deve estar no formato AAAA-MM-DD.',
    }),
  dataFim: z
    .string({ required_error: 'A data de fim é obrigatória.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'A data de fim deve estar no formato AAAA-MM-DD.',
    }),
  valorAluguel: toNumber(
    z
      .number({
        required_error: 'O valor do aluguel é obrigatório.',
        invalid_type_error: 'O valor do aluguel deve ser um número válido.',
      })
      .min(0, { message: 'O valor do aluguel deve ser maior ou igual a zero.' })
  ),
  diaVencimento: toNumber(
    z
      .number({
        required_error: 'O dia de vencimento é obrigatório.',
        invalid_type_error: 'O dia de vencimento deve ser um número válido.',
      })
      .int({ message: 'O dia de vencimento deve ser um número inteiro.' })
      .min(1, { message: 'O dia de vencimento deve estar entre 1 e 28.' })
      .max(28, { message: 'O dia de vencimento deve estar entre 1 e 28.' })
  ),
  indiceReajuste: z
    .enum(['IGPM', 'IPCA', 'INPC', 'FIXO'], {
      invalid_type_error: 'Índice de reajuste inválido.',
    })
    .optional()
    .default('IGPM'),
  periodicidadeReajusteMeses: toNumber(
    z
      .number({
        invalid_type_error:
          'A periodicidade de reajuste deve ser um número válido.',
      })
      .int({
        message: 'A periodicidade de reajuste deve ser um número inteiro.',
      })
      .min(12, {
        message:
          'A periodicidade de reajuste não pode ser inferior a 12 meses (Lei 10.192/2001).',
      })
      .optional()
  ),
  percentualMultaAtraso: toNumber(z.number().min(0).max(100).optional()),
  percentualJurosMoraMensal: toNumber(z.number().min(0).max(100).optional()),
  diasTolerancia: toNumber(z.number().int().min(0).optional()),
  taxaAdministracaoPercentual: toNumber(z.number().min(0).max(100).optional()),
  observacoes: z.string().optional(),
};

const registerContractSchema = z.object({
  ...baseContractShape,
  inquilinos: z
    .array(inquilinoSchema)
    .min(1, { message: 'É obrigatório informar ao menos um inquilino.' }),
});

const updateContractSchema = z.object({
  ...baseContractShape,
  dataDevolucaoImovel: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'A data de devolução deve estar no formato AAAA-MM-DD.',
      })
      .optional()
  ),
  status: z
    .enum(['ATIVO', 'ENCERRADO', 'RESCINDIDO', 'INADIMPLENTE'], {
      invalid_type_error: 'Status de contrato inválido.',
    })
    .optional(),
});

class ContractsController {
  async getContracts(request, response, next) {
    try {
      const contracts = await ContractsServices.getContracts();

      return response.status(200).json({
        status: 'success',
        data: contracts,
      });
    } catch (error) {
      next(error);
    }
  }

  async getContractById(request, response, next) {
    try {
      const { id } = request.params;

      const contract = await ContractsServices.getContractById(id);

      return response.status(200).json({
        status: 'success',
        data: contract,
      });
    } catch (error) {
      next(error);
    }
  }

  async registerContract(request, response, next) {
    try {
      const { contractData: rawContractData } = request.body;

      const contractData = registerContractSchema.parse(rawContractData);

      await ContractsServices.registerContract(contractData);

      return response.status(201).json({
        status: 'success',
        message: 'Contrato registrado com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateContract(request, response, next) {
    try {
      const { id } = request.params;

      const { contractData: rawContractData } = request.body;

      const contractData = updateContractSchema.parse(rawContractData);

      await ContractsServices.updateContract(id, contractData);

      return response.status(200).json({
        status: 'success',
        message: 'Contrato atualizado com sucesso.',
      });
    } catch (error) {
      console.log(error);
      next(error);
    }
  }

  async deleteContract(request, response, next) {
    try {
      const { id } = request.params;

      await ContractsServices.deleteContract(id);

      return response.status(200).json({
        status: 'success',
        message: 'Contrato deletado com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ContractsController();
