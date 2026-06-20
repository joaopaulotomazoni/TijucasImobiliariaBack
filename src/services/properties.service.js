import PropertiesRepository from '../repositories/properties.repository.js';
import AppError from '../errors/AppError.js';

class PropertiesService {
  async getProperties() {
    const properties = await PropertiesRepository.getProperties();

    return properties;
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

  async deleteProperties(id) {
    if (!id) {
      throw new AppError('O ID do imóvel é obrigatório.', 400);
    }

    return await PropertiesRepository.deleteProperties(id);
  }
}

export default new PropertiesService();
