import jwt from 'jsonwebtoken';

const TOKEN_EXPIRATION = process.env.JWT_EXPIRES_IN || '8h';

/**
 * Gera o JWT de autenticação com o payload padrão da aplicação.
 * Centraliza o formato do token para que todas as origens (login, verificação
 * de código, redefinição de senha) emitam exatamente as mesmas claims.
 *
 * @param {{ id: number, email: string, perfil?: string }} user
 * @returns {string} token assinado
 */
export function generateAuthToken({ id, email, perfil, auth_version, authVersion }) {
  return jwt.sign(
    {
      userId: id,
      email,
      perfil,
      authVersion: Number(authVersion ?? auth_version ?? 0),
    },
    process.env.JWT_SECRET,
    {
      expiresIn: TOKEN_EXPIRATION,
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER || 'tijucas-imobiliaria',
      audience: process.env.JWT_AUDIENCE || 'tijucas-imobiliaria-app',
    }
  );
}
