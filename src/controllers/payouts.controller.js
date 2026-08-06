import PayoutsService from '../services/payouts.service.js';

class PayoutsController {
  async dispararRepasse(request, response, next) {
    try {
      const { id } = request.params;

      const repasse = await PayoutsService.dispararRepasse(
        id,
        request.user.userId
      );

      return response.status(201).json({
        status: 'success',
        message: 'Repasse processado.',
        data: repasse,
      });
    } catch (error) {
      next(error);
    }
  }

  async listarRepasses(request, response, next) {
    try {
      const { id } = request.params;

      const repasses = await PayoutsService.listarRepasses(id);

      return response.status(200).json({ status: 'success', repasses });
    } catch (error) {
      next(error);
    }
  }
}

export default new PayoutsController();
