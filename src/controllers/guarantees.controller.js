import { z } from 'zod';
import GuaranteesServices from '../services/guarantees.service.js';
import { toNumber } from '../utils/zodHelpers.js';

const dateString = (message) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message });

// Endereço do imóvel dado em garantia pelo fiador (opcional).
const guaranteeAddressSchema = z.object({
  cep: z
    .string({ required_error: 'O CEP é obrigatório.' })
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 8, {
      message: 'O CEP deve conter 8 dígitos.',
    }),
  estado: z
    .string({ required_error: 'O estado é obrigatório.' })
    .length(2, { message: 'O estado deve ser a sigla com 2 letras (UF).' }),
  cidade: z.string().min(1, { message: 'A cidade é obrigatória.' }),
  bairro: z.string().min(1, { message: 'O bairro é obrigatório.' }),
  logradouro: z.string().min(1, { message: 'O logradouro é obrigatório.' }),
  numero: z.string().optional(),
  complemento: z.string().optional(),
});

// --- CAUÇÃO ---
// Por ora o sistema só aceita caução em dinheiro.
const caucaoSchema = z.object({
  tipo: z.literal('CAUCAO'),
  modalidade: z.enum(['DINHEIRO'], {
    required_error: 'A modalidade da caução é obrigatória.',
    invalid_type_error: 'No momento, apenas caução em dinheiro é aceita.',
  }),
  valor: toNumber(
    z
      .number({
        required_error: 'O valor da caução é obrigatório.',
        invalid_type_error: 'O valor da caução deve ser um número válido.',
      })
      .min(0, { message: 'O valor da caução deve ser maior ou igual a zero.' })
  ),
  banco: z.string().optional(),
  agencia: z.string().optional(),
  contaPoupanca: z.string().optional(),
  dataDeposito: dateString('Data de depósito inválida (AAAA-MM-DD).').optional(),
  comprovanteDepositoKey: z.string().optional(),
});

// --- FIADOR ---
const fiadorSchema = z.object({
  usuarioId: z.number({
    required_error: 'O ID do fiador é obrigatório.',
    invalid_type_error: 'O ID do fiador deve ser um número.',
  }),
  rendaComprovada: toNumber(z.number().min(0).optional()),
  comprovanteRendaKey: z.string().optional(),
  imovelGarantiaEnderecoId: z.number().optional(),
  imovelGarantiaEndereco: guaranteeAddressSchema.optional(),
  imovelGarantiaMatricula: z.string().optional(),
  imovelGarantiaQuitado: z.boolean().optional(),
  estadoCivil: z
    .enum(['SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIUVO', 'UNIAO_ESTAVEL'])
    .optional(),
  regimeBens: z
    .enum([
      'COMUNHAO_PARCIAL',
      'COMUNHAO_UNIVERSAL',
      'SEPARACAO_ABSOLUTA',
      'PARTICIPACAO_FINAL',
    ])
    .optional(),
  conjugeNome: z.string().optional(),
  conjugeDocumento: z.string().optional(),
  outorgaConjugal: z.boolean().optional(),
});

const fiadorGuaranteeSchema = z.object({
  tipo: z.literal('FIADOR'),
  fiadores: z
    .array(fiadorSchema)
    .min(1, { message: 'É obrigatório informar ao menos um fiador.' }),
});

// --- SEGURO FIANÇA ---
const seguroSchema = z.object({
  tipo: z.literal('SEGURO_FIANCA'),
  seguradora: z
    .string({ required_error: 'A seguradora é obrigatória.' })
    .min(1, { message: 'A seguradora é obrigatória.' }),
  numeroApolice: z
    .string({ required_error: 'O número da apólice é obrigatório.' })
    .min(1, { message: 'O número da apólice é obrigatório.' }),
  vigenciaInicio: dateString('Vigência início inválida (AAAA-MM-DD).'),
  vigenciaFim: dateString('Vigência fim inválida (AAAA-MM-DD).'),
  valorCobertura: toNumber(
    z
      .number({
        required_error: 'O valor da cobertura é obrigatório.',
        invalid_type_error: 'O valor da cobertura deve ser um número válido.',
      })
      .min(0, { message: 'O valor da cobertura deve ser maior ou igual a zero.' })
  ),
  valorPremio: toNumber(z.number().min(0).optional()),
  periodicidadePremio: z.enum(['MENSAL', 'ANUAL']).optional(),
  statusAprovacao: z
    .enum(['PENDENTE', 'APROVADA', 'REJEITADA'])
    .optional(),
  apoliceKey: z.string().optional(),
});

const guaranteeSchema = z.discriminatedUnion('tipo', [
  caucaoSchema,
  fiadorGuaranteeSchema,
  seguroSchema,
]);

const devolucaoSchema = z.object({
  valorDevolvido: toNumber(z.number().min(0).optional()),
  valorRetido: toNumber(z.number().min(0).optional()),
  motivoRetencao: z.string().optional(),
  dataDevolucao: dateString('Data de devolução inválida (AAAA-MM-DD).'),
});

const exoneracaoSchema = z.object({
  dataNotificacao: dateString('Data de notificação inválida (AAAA-MM-DD).'),
});

const substituteSchema = z.object({
  motivo: z.string().optional(),
  garantia: guaranteeSchema,
});

class GuaranteesController {
  async getGuaranteesByContract(request, response, next) {
    try {
      const { contratoId } = request.params;

      const guarantees =
        await GuaranteesServices.getGuaranteesByContract(contratoId);

      return response.status(200).json({
        status: 'success',
        data: guarantees,
      });
    } catch (error) {
      next(error);
    }
  }

  async createGuarantee(request, response, next) {
    try {
      const { contratoId } = request.params;

      const guaranteeData = guaranteeSchema.parse(request.body.guarantee);

      await GuaranteesServices.createGuarantee(contratoId, guaranteeData);

      return response.status(201).json({
        status: 'success',
        message: 'Garantia registrada com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async substituteGuarantee(request, response, next) {
    try {
      const { id } = request.params;

      const { motivo, garantia } = substituteSchema.parse(request.body);

      await GuaranteesServices.substituteGuarantee(id, motivo, garantia);

      return response.status(200).json({
        status: 'success',
        message: 'Garantia substituída com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async registerCaucaoDevolucao(request, response, next) {
    try {
      const { id } = request.params;

      const devolucaoData = devolucaoSchema.parse(request.body);

      await GuaranteesServices.registerCaucaoDevolucao(id, devolucaoData);

      return response.status(200).json({
        status: 'success',
        message: 'Devolução da caução registrada com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async exonerarFiador(request, response, next) {
    try {
      const { id, usuarioId } = request.params;

      const exoneracaoData = exoneracaoSchema.parse(request.body);

      const result = await GuaranteesServices.exonerarFiador(
        id,
        usuarioId,
        exoneracaoData
      );

      return response.status(200).json({
        status: 'success',
        message: 'Fiador exonerado com sucesso.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new GuaranteesController();
