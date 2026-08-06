import { z } from 'zod';
import UsersServices from '../services/users.service.js';
import { isValidCpfCnpj } from '../utils/brazilianDocument.js';
import { isValidIsoDate } from '../utils/isoDate.js';
import { clearAuthCookie, setAuthCookie } from '../utils/authCookie.js';

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
            .trim()
            .toLowerCase()
            .email({ message: 'Formato de e-mail inválido.' }),
          phone: z
            .string({ required_error: 'O telefone é obrigatório.' })
            .min(10, { message: 'O telefone deve ter no mínimo 10 dígitos.' }),
          document: z
            .string({ required_error: 'O documento é obrigatório.' })
            .transform((value) => value.replace(/\D/g, ''))
            .refine((value) => value.length === 11 || value.length === 14, {
              message: 'O documento deve conter 11 (CPF) ou 14 (CNPJ) dígitos.',
            })
            .refine(isValidCpfCnpj, {
              message: 'CPF/CNPJ inválido.',
            }),
          password: z
            .string({ required_error: 'A senha é obrigatória.' })
            .min(10, { message: 'A senha deve ter no mínimo 10 caracteres.' })
            .max(128, { message: 'A senha deve ter no máximo 128 caracteres.' }),
          confirmPassword: z.string({
            required_error: 'A confirmação de senha é obrigatória.',
          }),
          personType: z.enum(['PF', 'PJ'], {
            required_error: 'O tipo de pessoa é obrigatório.',
          }),
          rg: z.string().optional(),
          dataNascimento: z
            .string()
            .refine(isValidIsoDate, { message: 'Data de nascimento inválida.' })
            .optional(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: 'As senhas não coincidem.',
          path: ['confirmPassword'],
        });

      const userData = registerUserSchema.parse(request.body);

      const newUser = await UsersServices.saveNewUser(userData);

      return response.status(201).json({
        status: 'success',
        message: newUser.emailDeliveryPending
          ? 'Usuário registrado, mas o e-mail não pôde ser enviado. Solicite um novo código.'
          : 'Usuário registrado com sucesso',
        user: {
          id: newUser.id,
          fullName: newUser.nome_completo,
          email: newUser.email,
          emailDeliveryPending: Boolean(newUser.emailDeliveryPending),
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
        email: z
          .string({ required_error: 'O e-mail é obrigatório.' })
          .trim()
          .toLowerCase()
          .email({ message: 'Formato de e-mail inválido.' }),
      });

      const { email } = resendCodeSchema.parse(request.body);
      const tipo = request.path.startsWith('/forgot-password')
        ? 'RESET_SENHA'
        : 'VERIFICACAO_EMAIL';

      await UsersServices.sendVerificationFlow({ email, tipo });

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

      const { token: authToken, userData } =
        await UsersServices.confirmVerifyCode({
        code,
        userId,
      });
      setAuthCookie(response, authToken);

      return response.status(200).json({
        status: 'success',
        userData,
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
          .trim()
          .toLowerCase()
          .email({ message: 'Formato de e-mail inválido.' }),
        password: z.string().max(128).optional(),
      });

      const { email, password } = loginSchema.parse(request.body);

      const { userData, token, requiresPasswordSetup } =
        await UsersServices.login({
          email,
          password,
        });

      setAuthCookie(response, token);

      return response.status(200).json({
        status: 'success',
        message: 'Login bem-sucedido.',
        userData,
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
            .trim()
            .toLowerCase()
            .email({ message: 'Formato de e-mail inválido.' }),
          code: z.string({
            required_error: 'O código de verificação é obrigatório.',
          }),
          newPassword: z
            .string({ required_error: 'A nova senha é obrigatória.' })
            .min(10, { message: 'A senha deve ter no mínimo 10 caracteres.' })
            .max(128, { message: 'A senha deve ter no máximo 128 caracteres.' }),
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
      setAuthCookie(response, token);

      return response.status(200).json({
        status: 'success',
        message: 'Senha atualizada com sucesso.',
        userData,
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(_request, response) {
    clearAuthCookie(response);
    return response.status(204).send();
  }
}

export default new UsersController();
