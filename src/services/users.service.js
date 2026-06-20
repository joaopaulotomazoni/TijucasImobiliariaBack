import argon2 from 'argon2';
import UsersRepositories from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import { generateVerificationCode } from '../utils/generateVerificationCode.js';
import { generateAuthToken } from '../utils/generateAuthToken.js';
import EmailService from './email.service.js';
import usersRepositories from '../repositories/users.repository.js';

class UsersService {
  async sendVerificationFlow({ userId, email }) {
    const code = generateVerificationCode();
    const hashedCode = await argon2.hash(code);

    let effectiveUserId = userId;
    if (!userId) {
      const user = await UsersRepositories.getUserByEmail({ email });

      if (!user) {
        throw new AppError('Usuário não encontrado com este e-mail.', 404);
      }
      effectiveUserId = user.id;
    }

    await UsersRepositories.saveVerifyUserCode({
      userId: effectiveUserId,
      verifyCode: hashedCode,
    });

    EmailService.sendVerificationEmail(email, code).catch((error) => {
      console.error(
        'Falha ao enviar e-mail de verificação em background:',
        error
      );
    });
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

      if (userExistence.reason === true) {
        throw new AppError(
          'Já existe um usuário cadastrado com este e-mail.',
          409
        );
      }
    }

    const hashedPassword = await argon2.hash(userData.password);

    let newUser;
    if (!userExistence.exists) {
      newUser = await UsersRepositories.saveNewUser({
        ...userData,
        password: hashedPassword,
      });
    } else {
      newUser = await UsersRepositories.updateUserInfo({
        ...userData,
        password: hashedPassword,
      });
    }

    const insertedUser = newUser[0];

    await this.sendVerificationFlow({
      userId: insertedUser.id,
      email: insertedUser.email,
    });

    return insertedUser;
  }

  async confirmVerifyCode({ code, userId }) {
    const verifyCode = await UsersRepositories.getVerifyCode({ userId });

    if (!verifyCode) {
      throw new AppError(
        'Nenhum código de verificação encontrado para este usuário.',
        404
      );
    }

    const now = new Date();
    const expiresAt = new Date(verifyCode.expires_at);

    if (now > expiresAt) {
      throw new AppError(
        'Este código de verificação expirou. Solicite um novo envio.',
        400
      );
    }

    const isValid = await argon2.verify(verifyCode.codigo, code);

    if (!isValid) {
      throw new AppError('Código de verificação inválido.', 400);
    }

    const user = await usersRepositories.getUserById({ userId });

    const token = generateAuthToken(user);

    await UsersRepositories.updateUserEmailStatus({ userId });

    return token;
  }

  async updatePassword({ email, code, newPassword }) {
    const user = await UsersRepositories.getUserByEmail({ email });

    if (!user) {
      throw new AppError('Usuário não encontrado com este e-mail.', 404);
    }

    const verifyCode = await UsersRepositories.getVerifyCode({
      userId: user.id,
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
      throw new AppError(
        'Este código de verificação expirou. Solicite um novo envio.',
        400
      );
    }

    const isValid = await argon2.verify(verifyCode.codigo, code);

    if (!isValid) {
      throw new AppError('Código de verificação inválido.', 400);
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

    const token = generateAuthToken(user);

    return { userData, token };
  }

  async login({ email, password }) {
    const userData = await usersRepositories.getUserByEmail({ email });

    if (!userData) {
      throw new AppError('E-mail ou senha inválidos.', 401);
    }

    if (!userData.senha_hash) {
      return { requiresPasswordSetup: true, userData };
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
