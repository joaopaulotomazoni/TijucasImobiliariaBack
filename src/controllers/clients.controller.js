import { z } from 'zod';
import ClientsService from '../services/clients.service.js';
import { isValidCpfCnpj } from '../utils/brazilianDocument.js';
import { isValidIsoDate } from '../utils/isoDate.js';

const enderecoSchema = z.object({
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

const contaBancariaSchema = z
  .object({
    banco: z
      .string({ required_error: 'O banco é obrigatório.' })
      .min(1, { message: 'O banco é obrigatório.' }),
    agencia: z
      .string({ required_error: 'A agência é obrigatória.' })
      .min(1, { message: 'A agência é obrigatória.' }),
    conta: z
      .string({ required_error: 'A conta é obrigatória.' })
      .min(1, { message: 'A conta é obrigatória.' }),
    digito: z.string().optional(),
    tipoConta: z.enum(['CORRENTE', 'POUPANCA'], {
      required_error: 'O tipo de conta é obrigatório.',
      invalid_type_error: 'O tipo de conta deve ser CORRENTE ou POUPANCA.',
    }),
    chavePix: z.string().optional(),
    // Exigido pelo gateway de pagamento (Asaas) para identificar o tipo da
    // chave Pix no repasse — ver docs/migrations/004_financeiro.sql.
    pixKeyType: z.enum(['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA']).optional(),
    // Tem que bater com o titular da subconta no gateway (Fase 2), senão o
    // saque é recusado. Coletado já agora para não precisar retrabalho depois.
    cpfCnpjTitular: z
      .string()
      .transform((value) => value.replace(/\D/g, ''))
      .refine((value) => value.length === 11 || value.length === 14, {
        message: 'O CPF/CNPJ do titular deve conter 11 (CPF) ou 14 (CNPJ) dígitos.',
      })
      .optional(),
    principal: z.boolean().optional(),
    id: z.number().optional(),
  })
  .refine((conta) => !conta.chavePix || Boolean(conta.pixKeyType), {
    message: 'O tipo da chave Pix é obrigatório quando a chave Pix é informada.',
    path: ['pixKeyType'],
  });

const registerClientSchema = z.object({
  nomeCompleto: z
    .string({ required_error: 'O nome completo é obrigatório.' })
    .trim()
    .min(3, { message: 'O nome completo deve ter no mínimo 3 caracteres.' }),
  documento: z
    .string({ required_error: 'O documento é obrigatório.' })
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 11 || value.length === 14, {
      message: 'O documento deve conter 11 (CPF) ou 14 (CNPJ) dígitos.',
    })
    .refine(isValidCpfCnpj, { message: 'CPF/CNPJ inválido.' }),
  email: z
    .string({ required_error: 'O e-mail é obrigatório.' })
    .trim()
    .toLowerCase()
    .email({ message: 'Formato de e-mail inválido.' }),
  telefone: z
    .string({ required_error: 'O telefone é obrigatório.' })
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length >= 10, {
      message: 'O telefone deve ter no mínimo 10 dígitos.',
    }),
  rg: z.string().optional(),
  dataNascimento: z
    .string()
    .refine(isValidIsoDate, { message: 'Data de nascimento inválida.' })
    .optional(),
  endereco: z.preprocess((value) => {
    if (!value || typeof value !== 'object') return undefined;

    const hasContent = Object.values(value).some((fieldValue) =>
      typeof fieldValue === 'string'
        ? fieldValue.trim() !== ''
        : Boolean(fieldValue)
    );

    return hasContent ? value : undefined;
  }, enderecoSchema.optional()),
  contasBancarias: z.array(contaBancariaSchema).optional(),
}).superRefine((data, context) => {
  const accounts = data.contasBancarias ?? [];
  if (
    accounts.length > 0 &&
    accounts.filter((account) => account.principal).length !== 1
  ) {
    context.addIssue({
      code: 'custom',
      path: ['contasBancarias'],
      message: 'Informe exatamente uma conta bancária principal.',
    });
  }
});

class ClientsController {
  async registerClients(request, response, next) {
    try {
      const { clientData: rawClientData } = request.body;

      const clientData = registerClientSchema.parse({
        ...rawClientData,
      });

      await ClientsService.registerClients(clientData);

      return response.status(201).json({
        status: 'success',
        message: 'Cliente registrado com sucesso.',
      });
    } catch (error) {
      console.log(error);
      next(error);
    }
  }

  async getClients(request, response, next) {
    try {
      const clients = await ClientsService.getClients();

      return response.status(200).json({
        status: 'success',
        clients,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateClient(request, response, next) {
    try {
      const { id } = request.params;

      const { clientData: rawClientData } = request.body;

      const clientData = registerClientSchema.parse({
        ...rawClientData,
      });

      const clients = await ClientsService.updateClient(id, clientData);

      return response.status(200).json({
        status: 'success',
        clients,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteClient(request, response, next) {
    try {
      const { id } = request.params;

      const clients = await ClientsService.deleteClient(id);

      return response.status(200).json({
        status: 'success',
        clients,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ClientsController();
