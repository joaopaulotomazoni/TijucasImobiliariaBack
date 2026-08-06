import { z } from 'zod';
import BillingService from '../services/billing.service.js';
import { isValidIsoDate } from '../utils/isoDate.js';

const dateString = (message) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message })
    .refine(isValidIsoDate, { message });

const gerarCobrancaSchema = z.object({
  competencia: dateString('Competência inválida (AAAA-MM-01).'),
  dataVencimento: dateString('Data de vencimento inválida (AAAA-MM-DD).'),
  descricao: z.string().optional(),
});

const gerarLoteSchema = z.object({
  aPartirDe: dateString('Data inicial inválida (AAAA-MM-DD).').optional(),
});

const baixaManualSchema = z.object({
  valorPago: z.coerce.number().positive().optional(),
  dataPagamento: dateString('Data de pagamento inválida (AAAA-MM-DD).'),
  formaPagamento: z.enum(['PIX', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO']),
  comprovanteKey: z.string().optional(),
});

class BillingController {
  async gerarLote(request, response, next) {
    try {
      const { contratoId } = request.params;
      const payload = gerarLoteSchema.parse(request.body ?? {});
      const resultado = await BillingService.gerarCobrancasDoContrato(
        contratoId,
        payload
      );

      return response.status(200).json({
        status: resultado.completo ? 'success' : 'partial',
        message: resultado.completo
          ? 'Lote de boletos processado com sucesso.'
          : 'O lote foi processado com falhas e pode ser reexecutado com segurança.',
        data: resultado,
      });
    } catch (error) {
      next(error);
    }
  }

  async gerarCobranca(request, response, next) {
    try {
      const { contratoId } = request.params;
      const payload = gerarCobrancaSchema.parse(request.body);

      const parcela = await BillingService.gerarCobranca(contratoId, payload);

      return response.status(201).json({
        status: 'success',
        message: 'Cobrança gerada com sucesso.',
        data: parcela,
      });
    } catch (error) {
      next(error);
    }
  }

  async listarCobrancas(request, response, next) {
    try {
      const { contractId, status } = request.query;

      const parcelas = await BillingService.listarCobrancas({
        contratoId: contractId,
        status,
      });

      return response.status(200).json({ status: 'success', parcelas });
    } catch (error) {
      next(error);
    }
  }

  async detalharCobranca(request, response, next) {
    try {
      const { id } = request.params;

      const parcela = await BillingService.detalharCobranca(id);

      return response.status(200).json({ status: 'success', data: parcela });
    } catch (error) {
      next(error);
    }
  }

  async segundaVia(request, response, next) {
    try {
      const { id } = request.params;

      const cobranca = await BillingService.segundaVia(id);

      return response.status(200).json({ status: 'success', data: cobranca });
    } catch (error) {
      next(error);
    }
  }

  async cancelarCobranca(request, response, next) {
    try {
      const { id } = request.params;

      const resultado = await BillingService.cancelarCobranca(id);

      return response.status(200).json({
        status: 'success',
        message: 'Cobrança cancelada.',
        data: resultado,
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelarCobrancasDoContrato(request, response, next) {
    try {
      const data = await BillingService.cancelarCobrancasDoContrato(
        request.params.contratoId
      );
      return response.status(data.completo ? 200 : 207).json({
        status: data.completo ? 'success' : 'partial',
        message: data.completo
          ? 'Todos os boletos ativos foram cancelados.'
          : 'Parte dos boletos não pôde ser cancelada.',
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  async baixaManual(request, response, next) {
    try {
      const payload = baixaManualSchema.parse(request.body);
      const data = await BillingService.registrarBaixaManual(
        request.params.id,
        payload,
        request.user.userId
      );
      return response.status(200).json({
        status: 'success',
        message: 'Boleto cancelado no gateway e pagamento presencial registrado.',
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new BillingController();
