import { z } from 'zod';
import PaymentsService from '../services/payments.service.js';
import { toNumber } from '../utils/zodHelpers.js';

const dateString = (message) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message });

const registerPaymentSchema = z.object({
  valorPago: toNumber(
    z
      .number({
        required_error: 'O valor pago é obrigatório.',
        invalid_type_error: 'O valor pago deve ser um número válido.',
      })
      .min(0.01, { message: 'O valor pago deve ser maior que zero.' })
  ),
  dataPagamento: dateString('Data de pagamento inválida (AAAA-MM-DD).'),
  formaPagamento: z.enum(
    ['PIX', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO'],
    {
      required_error: 'A forma de pagamento é obrigatória.',
      invalid_type_error: 'Forma de pagamento inválida.',
    }
  ),
  comprovanteKey: z.string().optional(),
});

class PaymentsController {
  async getMyPayments(request, response, next) {
    try {
      const { userId } = request.user;

      const parcelas = await PaymentsService.getMyPayments(userId);

      return response.status(200).json({
        status: 'success',
        parcelas,
      });
    } catch (error) {
      next(error);
    }
  }

  async registerPayment(request, response, next) {
    try {
      const { userId } = request.user;
      const { parcelaId } = request.params;

      const paymentData = registerPaymentSchema.parse(request.body);

      const data = await PaymentsService.registerPayment(
        parcelaId,
        userId,
        paymentData
      );

      return response.status(201).json({
        status: 'success',
        message: 'Pagamento registrado com sucesso.',
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new PaymentsController();
