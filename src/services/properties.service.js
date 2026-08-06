import PropertiesRepository from '../repositories/properties.repository.js';
import AppError from '../errors/AppError.js';
import { normalizePositiveBigintId } from '../utils/ids.js';

class PropertiesService {
  async getProperties() {
    const properties = await PropertiesRepository.getProperties();

    return properties;
  }

  async getPropertyById(id) {
    const normalizedId = normalizePositiveBigintId(id, 'O ID do imóvel');
    const property = await PropertiesRepository.getPropertyById(normalizedId);

    if (!property) {
      throw new AppError('Imóvel não encontrado.', 404);
    }

    return property;
  }

  async registerProperties(propertiesData) {
    return await PropertiesRepository.registerProperties(propertiesData);
  }

  async updateProperties(id, propertyData) {
    if (!id) {
      throw new AppError('O ID do imóvel é obrigatório.', 400);
    }

    return await PropertiesRepository.updateProperties(id, propertyData);
  }

  async getOwners() {
    return await PropertiesRepository.getOwners();
  }

  async getOwnersPortfolio() {
    return await PropertiesRepository.getOwnersPortfolio();
  }

  async deleteProperties(id) {
    if (!id) {
      throw new AppError('O ID do imóvel é obrigatório.', 400);
    }

    return await PropertiesRepository.deleteProperties(id);
  }
}

export default new PropertiesService();
