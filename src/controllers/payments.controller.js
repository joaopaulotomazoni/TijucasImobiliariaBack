import PaymentsService from '../services/payments.service.js';

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

  async getMyBoleto(request, response, next) {
    try {
      const { userId } = request.user;
      const { parcelaId } = request.params;
      const boleto = await PaymentsService.getMyBoleto(parcelaId, userId);

      return response.status(200).json({
        status: 'success',
        data: boleto,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new PaymentsController();
