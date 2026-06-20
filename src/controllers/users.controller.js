import { z } from 'zod';
import UsersServices from '../services/users.service.js';

class UsersController {
  async registerUser(request, response, next) {
    try {
      const registerUserSchema = z
        .object({
          fullName: z
            .string({ required_error: 'O nome completo é obrigatório.' })
            .min(3, {
              message: 'O nome completo deve ter no mínimo 3 caracteres.',
            }),
          email: z
            .string({ required_error: 'O e-mail é obrigatório.' })
            .email({ message: 'Formato de e-mail inválido.' }),
          phone: z
            .string({ required_error: 'O telefone é obrigatório.' })
            .min(10, { message: 'O telefone deve ter no mínimo 10 dígitos.' }),
          document: z
            .string({ required_error: 'O documento é obrigatório.' })
            .transform((value) => value.replace(/\D/g, ''))
            .refine((value) => value.length === 11 || value.length === 14, {
              message: 'O documento deve conter 11 (CPF) ou 14 (CNPJ) dígitos.',
            }),
          password: z
            .string({ required_error: 'A senha é obrigatória.' })
            .min(6, { message: 'A senha deve ter no mínimo 6 caracteres.' }),
          confirmPassword: z.string({
            required_error: 'A confirmação de senha é obrigatória.',
          }),
          personType: z.enum(['PF', 'PJ'], {
            required_error: 'O tipo de pessoa é obrigatório.',
          }),
          rg: z.string().optional(),
          dataNascimento: z.string().optional(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: 'As senhas não coincidem.',
          path: ['confirmPassword'],
        });

      const userData = registerUserSchema.parse(request.body);

      const newUser = await UsersServices.saveNewUser(userData);

      return response.status(201).json({
        status: 'success',
        message: 'Usuário registrado com sucesso',
        user: {
          id: newUser.id,
          fullName: newUser.nome_completo,
          email: newUser.email,
        },
      });
    } catch (error) {
      console.log({ error });
      next(error);
    }
  }

  async sendVerifyCode(request, response, next) {
    try {
      const resendCodeSchema = z.object({
        userId: z.number().optional(),
        email: z
          .string({ required_error: 'O e-mail é obrigatório.' })
          .email({ message: 'Formato de e-mail inválido.' }),
      });

      const { userId, email } = resendCodeSchema.parse(request.body);

      await UsersServices.sendVerificationFlow({ userId, email });

      return response.status(200).json({
        status: 'success',
        message: 'Novo código de verificação enviado com sucesso.',
      });
    } catch (error) {
      console.error('Erro de validação:', error);
      next(error);
    }
  }

  async confirmVerifyCode(request, response, next) {
    try {
      const confirmCodeSchema = z.object({
        code: z.string({
          required_error: 'O código de verificação é obrigatório.',
        }),
        userId: z.number({ required_error: 'O ID do usuário é obrigatório.' }),
      });

      const { code, userId } = confirmCodeSchema.parse(request.body);

      const authToken = await UsersServices.confirmVerifyCode({
        code,
        userId,
      });

      return response.status(200).json({
        status: 'success',
        authToken,
      });
    } catch (error) {
      console.log(error);
      next(error);
    }
  }

  async login(request, response, next) {
    try {
      const loginSchema = z.object({
        email: z
          .string({ required_error: 'O e-mail é obrigatório.' })
          .email({ message: 'Formato de e-mail inválido.' }),
        password: z.string().optional(),
      });

      const { email, password } = loginSchema.parse(request.body);

      const { userData, token, requiresPasswordSetup } =
        await UsersServices.login({
          email,
          password,
        });

      if (requiresPasswordSetup) {
        return response.status(200).json({
          status: 'success',
          requiresPasswordSetup: true,
          userId: userData.id,
          message: 'Defina sua senha para continuar.',
        });
      }

      return response.status(200).json({
        status: 'success',
        message: 'Login bem-sucedido.',
        userData,
        token,
      });
    } catch (error) {
      next(error);
    }
  }

  async updatePassword(request, response, next) {
    try {
      const updatePasswordSchema = z
        .object({
          email: z
            .string({ required_error: 'O e-mail é obrigatório.' })
            .email({ message: 'Formato de e-mail inválido.' }),
          code: z.string({
            required_error: 'O código de verificação é obrigatório.',
          }),
          newPassword: z
            .string({ required_error: 'A nova senha é obrigatória.' })
            .min(6, { message: 'A senha deve ter no mínimo 6 caracteres.' }),
          confirmPassword: z.string({
            required_error: 'A confirmação de senha é obrigatória.',
          }),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: 'As senhas não coincidem.',
          path: ['confirmPassword'],
        });

      const { email, code, newPassword } = updatePasswordSchema.parse(
        request.body
      );

      const { userData, token } = await UsersServices.updatePassword({
        email,
        code,
        newPassword,
      });

      return response.status(200).json({
        status: 'success',
        message: 'Senha atualizada com sucesso.',
        userData,
        token,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new UsersController();
