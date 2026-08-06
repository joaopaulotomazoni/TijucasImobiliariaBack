import argon2 from 'argon2';
import UsersRepositories from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import { generateVerificationCode } from '../utils/generateVerificationCode.js';
import { generateAuthToken } from '../utils/generateAuthToken.js';
import EmailService from './email.service.js';

class UsersService {
  async _sendVerificationToUser(user, tipo) {
    if (!user || user.ativo === false) {
      throw new AppError('Usuário não encontrado com este e-mail.', 404);
    }

    const existing = await UsersRepositories.getVerifyCode({
      userId: user.id,
      tipo,
    });

    if (
      existing?.created_at &&
      Date.now() - new Date(existing.created_at).getTime() < 60000
    ) {
      throw new AppError(
        'Aguarde um minuto antes de solicitar outro código.',
        429
      );
    }

    const code = generateVerificationCode();
    const hashedCode = await argon2.hash(code);

    await UsersRepositories.saveVerifyUserCode({
      userId: user.id,
      verifyCode: hashedCode,
      tipo,
    });

    // O destinatário vem sempre do cadastro resolvido no banco. Nunca use o
    // par userId/e-mail fornecido pelo cliente, que permitiria enviar o código
    // de uma vítima para um endereço controlado por outra pessoa.
    await EmailService.sendVerificationEmail(user.email, code);
  }

  async sendVerificationFlow({ email, tipo = 'VERIFICACAO_EMAIL' }) {
    const user = await UsersRepositories.getUserByEmail({ email });
    if (!user && tipo === 'RESET_SENHA') return;

    return this._sendVerificationToUser(user, tipo);
  }

  async sendVerificationToUserId(userId) {
    const user = await UsersRepositories.getUserById({ userId });

    return this._sendVerificationToUser(user, 'VERIFICACAO_EMAIL');
  }

  async saveNewUser(userData) {
    const userExistence = await UsersRepositories.verifyUserExistence(userData);

    if (userExistence.exists) {
      if (userExistence.reason === 'document') {
        throw new AppError(
          'Já existe um usuário cadastrado com este documento.',
          409
        );
      }

      if (userExistence.reason === true || userExistence.reason === false) {
        throw new AppError(
          'Já existe um usuário cadastrado com este e-mail.',
          409
        );
      }
    }

    const hashedPassword = await argon2.hash(userData.password);

    const newUser = await UsersRepositories.saveNewUser({
      ...userData,
      password: hashedPassword,
    });

    const insertedUser = newUser[0];

    try {
      await this.sendVerificationToUserId(insertedUser.id);
    } catch (error) {
      console.error('Falha ao enviar o primeiro código de verificação:', error);
      insertedUser.emailDeliveryPending = true;
    }

    return insertedUser;
  }

  async confirmVerifyCode({ code, userId }) {
    const verifyCode = await UsersRepositories.getVerifyCode({
      userId,
      tipo: 'VERIFICACAO_EMAIL',
    });

    if (!verifyCode) {
      throw new AppError(
        'Nenhum código de verificação encontrado para este usuário.',
        404
      );
    }

    const now = new Date();
    const expiresAt = new Date(verifyCode.expires_at);

    if (now > expiresAt) {
      await UsersRepositories.consumeVerifyCode({ id: verifyCode.id });
      throw new AppError(
        'Este código de verificação expirou. Solicite um novo envio.',
        400
      );
    }

    if (Number(verifyCode.tentativas_falhas) >= 5) {
      throw new AppError('Código de verificação inválido.', 400);
    }

    const isValid = await argon2.verify(verifyCode.codigo, code);

    if (!isValid) {
      await UsersRepositories.registerFailedVerificationAttempt({
        id: verifyCode.id,
      });
      throw new AppError('Código de verificação inválido.', 400);
    }

    const user = await UsersRepositories.getUserById({ userId });

    if (!user || user.ativo === false) {
      throw new AppError('Código de verificação inválido.', 400);
    }

    const consumed = await UsersRepositories.consumeVerifyCode({
      id: verifyCode.id,
    });

    if (!consumed) {
      throw new AppError('Código de verificação inválido ou já utilizado.', 400);
    }

    await UsersRepositories.updateUserEmailStatus({ userId });

    const { senha_hash, ...safeUser } = user;
    return {
      token: generateAuthToken(user),
      userData: { ...safeUser, email_verificado: true },
    };
  }

  async updatePassword({ email, code, newPassword }) {
    const user = await UsersRepositories.getUserByEmail({ email });

    if (!user) {
      throw new AppError('Código de verificação inválido ou expirado.', 400);
    }

    if (user.ativo === false) {
      throw new AppError('Código de verificação inválido ou expirado.', 400);
    }

    const verifyCode = await UsersRepositories.getVerifyCode({
      userId: user.id,
      tipo: 'RESET_SENHA',
    });

    if (!verifyCode) {
      throw new AppError(
        'Nenhum código de verificação encontrado para este usuário.',
        404
      );
    }

    const now = new Date();
    const expiresAt = new Date(verifyCode.expires_at);

    if (now > expiresAt) {
      await UsersRepositories.consumeVerifyCode({ id: verifyCode.id });
      throw new AppError(
        'Este código de verificação expirou. Solicite um novo envio.',
        400
      );
    }

    if (Number(verifyCode.tentativas_falhas) >= 5) {
      throw new AppError('Código de verificação inválido.', 400);
    }

    const isValid = await argon2.verify(verifyCode.codigo, code);

    if (!isValid) {
      await UsersRepositories.registerFailedVerificationAttempt({
        id: verifyCode.id,
      });
      throw new AppError('Código de verificação inválido.', 400);
    }

    const consumed = await UsersRepositories.consumeVerifyCode({
      id: verifyCode.id,
    });

    if (!consumed) {
      throw new AppError('Código de verificação inválido ou já utilizado.', 400);
    }

    const hashedPassword = await argon2.hash(newPassword);

    const updatedUsers = await UsersRepositories.updateUserPassword({
      userId: user.id,
      password: hashedPassword,
    });

    if (!user.email_verificado) {
      await UsersRepositories.updateUserEmailStatus({ userId: user.id });
    }

    const userData = updatedUsers[0];

    const token = generateAuthToken(userData);

    return { userData, token };
  }

  async login({ email, password }) {
    const userData = await UsersRepositories.getUserByEmail({ email });

    if (!userData) {
      throw new AppError('E-mail ou senha inválidos.', 401);
    }

    if (userData.ativo === false) {
      throw new AppError('E-mail ou senha inválidos.', 401);
    }

    if (!userData.email_verificado || !password) {
      throw new AppError('E-mail ou senha inválidos.', 401);
    }

    const isPasswordValid = await argon2.verify(userData.senha_hash, password);

    if (!isPasswordValid) {
      throw new AppError('E-mail ou senha inválidos.', 401);
    }

    const token = generateAuthToken(userData);

    const { senha_hash, ...safeUserData } = userData;

    return { userData: safeUserData, token };
  }
}

export default new UsersService();
