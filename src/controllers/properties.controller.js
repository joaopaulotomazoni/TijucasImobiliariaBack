import { z } from 'zod';
import PropertiesServices from '../services/properties.service.js';
import { toNumber } from '../utils/zodHelpers.js';

const addressSchema = z.object({
  id: z.number().optional(),
  cep: z
    .string({ required_error: 'O CEP é obrigatório.' })
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 8, {
      message: 'O CEP deve conter 8 dígitos.',
    }),
  estado: z
    .string({ required_error: 'O estado é obrigatório.' })
    .length(2, { message: 'O estado deve ser a sigla com 2 letras (UF).' }),
  cidade: z
    .string({ required_error: 'A cidade é obrigatória.' })
    .min(1, { message: 'A cidade é obrigatória.' }),
  bairro: z
    .string({ required_error: 'O bairro é obrigatório.' })
    .min(1, { message: 'O bairro é obrigatório.' }),
  logradouro: z
    .string({ required_error: 'O logradouro é obrigatório.' })
    .min(1, { message: 'O logradouro é obrigatório.' }),
  numero: z.string().optional(),
  complemento: z.string().optional(),
});

const propertyReferenceSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  },
  z
    .string()
    .min(1, { message: 'O número de referência não pode ficar em branco.' })
    .max(80, {
      message: 'O número de referência deve possuir no máximo 80 caracteres.',
    })
    .optional()
);

const registerPropertySchema = z.object({
  numeroReferencia: propertyReferenceSchema,
  tipoImovel: z.enum(
    ['CASA', 'APARTAMENTO', 'COMERCIAL', 'TERRENO', 'GALPAO', 'OUTRO'],
    {
      required_error: 'O tipo de imóvel é obrigatório.',
      invalid_type_error: 'Tipo de imóvel inválido.',
    }
  ),
  ownerId: z.number({
    required_error: 'O proprietário é obrigatório.',
    invalid_type_error: 'O proprietário é obrigatório.',
  }).int().positive(),
  valorAluguelReferencia: toNumber(
    z
      .number({
        required_error: 'O valor do aluguel de referência é obrigatório.',
        invalid_type_error:
          'O valor do aluguel de referência deve ser um número válido.',
      })
      .min(0, {
        message:
          'O valor do aluguel de referência deve ser maior ou igual a zero.',
      })
  ),
  valorCondominio: toNumber(
    z
      .number({
        invalid_type_error: 'O valor do condomínio deve ser um número válido.',
      })
      .min(0, {
        message: 'O valor do condomínio deve ser maior ou igual a zero.',
      })
      .optional()
  ),
  valorIptu: toNumber(
    z
      .number({
        invalid_type_error: 'O valor do IPTU deve ser um número válido.',
      })
      .min(0, { message: 'O valor do IPTU deve ser maior ou igual a zero.' })
      .optional()
  ),
  areaUtil: toNumber(
    z
      .number({ invalid_type_error: 'A área útil deve ser um número válido.' })
      .min(0, { message: 'A área útil deve ser maior ou igual a zero.' })
      .optional()
  ),
  quartos: toNumber(
    z
      .number({
        required_error: 'O número de quartos é obrigatório.',
        invalid_type_error: 'O número de quartos deve ser um número válido.',
      })
      .int({ message: 'O número de quartos deve ser um número inteiro.' })
      .min(0, {
        message: 'O número de quartos deve ser maior ou igual a zero.',
      })
  ),
  banheiros: toNumber(
    z
      .number({
        required_error: 'O número de banheiros é obrigatório.',
        invalid_type_error: 'O número de banheiros deve ser um número válido.',
      })
      .int({ message: 'O número de banheiros deve ser um número inteiro.' })
      .min(0, {
        message: 'O número de banheiros deve ser maior ou igual a zero.',
      })
  ),
  vagasGaragem: toNumber(
    z
      .number({
        required_error: 'O número de vagas de garagem é obrigatório.',
        invalid_type_error:
          'O número de vagas de garagem deve ser um número válido.',
      })
      .int({
        message: 'O número de vagas de garagem deve ser um número inteiro.',
      })
      .min(0, {
        message: 'O número de vagas de garagem deve ser maior ou igual a zero.',
      })
  ),
  matricula: z.string().optional(),
  inscricaoIptu: z.string().optional(),
  observacoes: z.string().optional(),
  status: z
    .enum(['DISPONIVEL', 'ALUGADO', 'MANUTENCAO', 'INATIVO'], {
      invalid_type_error: 'Status de imóvel inválido.',
    })
    .optional()
    .default('DISPONIVEL'),
  address: addressSchema,
});

class PropertiesController {
  async getProperties(request, response, next) {
    try {
      const properties = await PropertiesServices.getProperties();

      return response.status(200).json({
        status: 'success',
        properties,
      });
    } catch (error) {
      next(error);
    }
  }

  async getPropertyById(request, response, next) {
    try {
      const property = await PropertiesServices.getPropertyById(
        request.params.id
      );

      return response.status(200).json({
        status: 'success',
        property,
      });
    } catch (error) {
      next(error);
    }
  }

  async registerProperties(request, response, next) {
    try {
      const { propertiesData } = request.body;

      const propertyData = registerPropertySchema.parse(propertiesData);

      await PropertiesServices.registerProperties(propertyData);

      return response.status(201).json({
        status: 'success',
        message: 'Imóvel registrado com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProperties(request, response, next) {
    try {
      const { id } = request.params;

      const { propertiesData } = request.body;

      const propertyData = registerPropertySchema.parse(propertiesData);

      await PropertiesServices.updateProperties(id, propertyData);

      return response.status(200).json({
        status: 'success',
        message: 'Imóvel atualizado com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteProperties(request, response, next) {
    try {
      const { id } = request.params;

      await PropertiesServices.deleteProperties(id);

      return response.status(200).json({
        status: 'success',
        message: 'Imóvel deletado com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  async getOwners(request, response, next) {
    try {
      const owners = await PropertiesServices.getOwners();

      return response.status(200).json({
        status: 'success',
        data: owners,
      });
    } catch (error) {
      next(error);
    }
  }

  async getOwnersPortfolio(request, response, next) {
    try {
      const owners = await PropertiesServices.getOwnersPortfolio();
      return response.status(200).json({ status: 'success', data: owners });
    } catch (error) {
      next(error);
    }
  }
}

export default new PropertiesController();
