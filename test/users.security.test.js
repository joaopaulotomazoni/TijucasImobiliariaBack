import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SECRET_KEY ||= 'test-key';
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'unit-test-secret';

const { default: UsersService } = await import(
  '../src/services/users.service.js'
);
const { default: UsersRepository } = await import(
  '../src/repositories/users.repository.js'
);
const { default: EmailService } = await import(
  '../src/services/email.service.js'
);
const { authMiddleware } = await import(
  '../src/middlewares/authMiddleware.js'
);

test('reenvio público resolve usuário e destinatário pelo mesmo e-mail', async () => {
  const originalGet = UsersRepository.getUserByEmail;
  const originalSave = UsersRepository.saveVerifyUserCode;
  const originalGetCode = UsersRepository.getVerifyCode;
  const originalSend = EmailService.sendVerificationEmail;
  const observed = {};

  try {
    UsersRepository.getUserByEmail = async ({ email }) => {
      observed.lookup = email;
      return {
        id: 7,
        email: 'canonical@example.com',
        ativo: true,
      };
    };
    UsersRepository.saveVerifyUserCode = async (input) => {
      observed.saved = input;
    };
    UsersRepository.getVerifyCode = async () => null;
    EmailService.sendVerificationEmail = async (email) => {
      observed.recipient = email;
    };

    await UsersService.sendVerificationFlow({
      userId: 999,
      email: 'canonical@example.com',
      tipo: 'RESET_SENHA',
    });

    assert.equal(observed.lookup, 'canonical@example.com');
    assert.equal(observed.saved.userId, 7);
    assert.equal(observed.saved.tipo, 'RESET_SENHA');
    assert.equal(observed.recipient, 'canonical@example.com');
  } finally {
    UsersRepository.getUserByEmail = originalGet;
    UsersRepository.saveVerifyUserCode = originalSave;
    UsersRepository.getVerifyCode = originalGetCode;
    EmailService.sendVerificationEmail = originalSend;
  }
});

test('usuário inativo não realiza login', async () => {
  const originalGet = UsersRepository.getUserByEmail;

  try {
    UsersRepository.getUserByEmail = async () => ({
      id: 8,
      ativo: false,
      senha_hash: null,
      email_verificado: true,
    });

    await assert.rejects(
      UsersService.login({ email: 'inactive@example.com' }),
      (error) => error.statusCode === 401
    );
  } finally {
    UsersRepository.getUserByEmail = originalGet;
  }
});

test('middleware recarrega perfil atual e bloqueia usuário desativado', async () => {
  const originalGet = UsersRepository.getUserById;
  const token = jwt.sign(
    {
      userId: 9,
      email: 'old@example.com',
      perfil: 'ADMIN',
      authVersion: 0,
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'tijucas-imobiliaria',
      audience: 'tijucas-imobiliaria-app',
    }
  );
  const request = { headers: { authorization: `Bearer ${token}` } };
  const response = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  try {
    UsersRepository.getUserById = async () => ({
      id: 9,
      email: 'current@example.com',
      perfil: 'CLIENTE',
      ativo: true,
      auth_version: 0,
    });
    await authMiddleware(request, response, () => undefined);
    assert.equal(request.user.perfil, 'CLIENTE');
    assert.equal(request.user.email, 'current@example.com');

    UsersRepository.getUserById = async () => ({
      id: 9,
      perfil: 'CLIENTE',
      ativo: false,
    });
    await authMiddleware(request, response, () => undefined);
    assert.equal(response.statusCode, 401);
  } finally {
    UsersRepository.getUserById = originalGet;
  }
});
