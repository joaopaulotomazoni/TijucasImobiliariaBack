import DashboardRepository from '../repositories/dashboard.repository.js';

class DashboardController {
  async summary(_request, response, next) {
    try {
      const data = await DashboardRepository.getSummary();
      return response.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  }
}

export default new DashboardController();
