import { z } from 'zod';
import ContractsServices from '../services/contracts.service.js';
import { toNumber } from '../utils/zodHelpers.js';
import { isValidIsoDate } from '../utils/isoDate.js';

const dateString = (requiredMessage, invalidMessage) =>
  z
    .string({ required_error: requiredMessage })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: invalidMessage })
    .refine(isValidIsoDate, { message: invalidMessage });

const inquilinoSchema = z.object({
  usuarioId: z.number({
    required_error: 'O ID do inquilino é obrigatório.',
    invalid_type_error: 'O ID do inquilino deve ser um número.',
  }).int().positive(),
  principal: z.boolean().optional(),
});

const inquilinosSchema = z
  .array(inquilinoSchema)
  .min(1, { message: 'É obrigatório informar ao menos um inquilino.' })
  .superRefine((inquilinos, context) => {
    const ids = inquilinos.map((inquilino) => inquilino.usuarioId);

    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'Um inquilino não pode ser vinculado duas vezes ao contrato.',
      });
    }

    if (inquilinos.filter((inquilino) => inquilino.principal).length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Informe exatamente um inquilino principal.',
      });
    }
  });

function assertContractPeriod(contractData, context) {
  if (contractData.dataFim <= contractData.dataInicio) {
    context.addIssue({
      code: 'custom',
      path: ['dataFim'],
      message: 'A data de fim deve ser posterior à data de início.',
    });
  }
}

const baseContractShape = {
  imovelId: z.number({
    required_error: 'O imóvel é obrigatório.',
    invalid_type_error: 'O imóvel é obrigatório.',
  }).int().positive(),
  corretorId: z.number().int().positive().optional(),
  dataInicio: dateString(
    'A data de início é obrigatória.',
    'A data de início deve ser válida e estar no formato AAAA-MM-DD.'
  ),
  dataFim: dateString(
    'A data de fim é obrigatória.',
    'A data de fim deve ser válida e estar no formato AAAA-MM-DD.'
  ),
  valorAluguel: toNumber(
    z
      .number({
        required_error: 'O valor do aluguel é obrigatório.',
        invalid_type_error: 'O valor do aluguel deve ser um número válido.',
      })
      .min(0.01, { message: 'O valor do aluguel deve ser maior que zero.' })
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

const registerContractSchema = z
  .object({
    ...baseContractShape,
    inquilinos: inquilinosSchema,
    migrado: z.boolean().optional().default(false),
  })
  .superRefine(assertContractPeriod);

const updateContractSchema = z
  .object({
    ...baseContractShape,
    // Opcional para manter compatibilidade com clientes antigos. Quando
    // enviado, substitui os vínculos e continua exigindo exatamente um titular.
    inquilinos: inquilinosSchema.optional(),
    dataDevolucaoImovel: z.preprocess(
      (value) => (value === '' ? undefined : value),
      dateString(
        'A data de devolução é obrigatória.',
        'A data de devolução deve ser válida e estar no formato AAAA-MM-DD.'
      ).optional()
    ),
    status: z
      .enum(['ATIVO', 'ENCERRADO', 'RESCINDIDO', 'INADIMPLENTE'], {
        invalid_type_error: 'Status de contrato inválido.',
      })
      .optional(),
  })
  .superRefine(assertContractPeriod);

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

      const result = await ContractsServices.registerContract(contractData);
      const statusCode = result.cobrancas.completo ? 201 : 202;

      return response.status(statusCode).json({
        status: result.cobrancas.completo ? 'success' : 'partial',
        message: result.cobrancas.completo
          ? 'Contrato e boletos registrados com sucesso.'
          : 'Contrato registrado, mas parte dos boletos precisa ser reprocessada.',
        data: result,
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

  async registerHistoricalPayments(request, response, next) {
    try {
      const historicalPaymentSchema = z.object({
        pagamentos: z.array(z.object({
          competencia: dateString(
            'A competência é obrigatória.',
            'Competência inválida (AAAA-MM-01).'
          ).refine((value) => value.endsWith('-01'), {
            message: 'A competência deve usar o primeiro dia do mês.',
          }),
          dataVencimento: dateString(
            'A data de vencimento é obrigatória.',
            'Data de vencimento inválida.'
          ),
          dataPagamento: dateString(
            'A data de pagamento é obrigatória.',
            'Data de pagamento inválida.'
          ),
          valorPago: toNumber(z.number().positive()),
          formaPagamento: z.enum([
            'PIX', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO',
          ]),
          comprovanteKey: z.string().optional(),
        })).min(1).max(120),
      });
      const payload = historicalPaymentSchema.parse(request.body);
      const data = await ContractsServices.registerHistoricalPayments(
        request.params.id,
        payload.pagamentos,
        request.user.userId
      );
      return response.status(201).json({
        status: 'success',
        message: 'Pagamentos históricos registrados sem emissão no gateway.',
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ContractsController();
