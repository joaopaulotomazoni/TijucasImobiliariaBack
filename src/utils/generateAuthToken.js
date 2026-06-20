import jwt from 'jsonwebtoken';

const TOKEN_EXPIRATION = '7d';

/**
 * Gera o JWT de autenticação com o payload padrão da aplicação.
 * Centraliza o formato do token para que todas as origens (login, verificação
 * de código, redefinição de senha) emitam exatamente as mesmas claims.
 *
 * @param {{ id: number, email: string, perfil?: string }} user
 * @returns {string} token assinado
 */
export function generateAuthToken({ id, email, perfil }) {
  return jwt.sign(
    { userId: id, email, perfil },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRATION }
  );
}
