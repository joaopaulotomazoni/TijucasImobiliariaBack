import ClientsRepository from '../repositories/clients.repository.js';
import AppError from '../errors/AppError.js';
import usersRepository from '../repositories/users.repository.js';

class ClientsService {
  async registerClients(clientData) {
    try {
      const clientExistence = await usersRepository.verifyUserExistence({
        email: clientData.email,
        document: clientData.documento,
      });

      if (clientExistence.exists) {
        if (clientExistence.reason === 'document') {
          throw new AppError(
            'Já existe um cliente cadastrado com este documento.',
            409
          );
        }

        throw new AppError(
          'Já existe um cliente cadastrado com este e-mail.',
          409
        );
      }

      await ClientsRepository.registerClient(clientData);
      return;
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(
          'Já existe um cliente cadastrado com este documento, e-mail ou telefone.',
          409
        );
      }

      throw error;
    }
  }

  async getClients() {
    return await ClientsRepository.getClients();
  }

  async updateClient(id, clientData) {
    return await ClientsRepository.updateClient(id, clientData);
  }

  async deleteClient(id) {
    return await ClientsRepository.deleteClient(id);
  }
}

export default new ClientsService();
