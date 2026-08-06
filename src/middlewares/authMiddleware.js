import jwt from 'jsonwebtoken';
import UsersRepository from '../repositories/users.repository.js';
import { getAuthCookieName } from '../utils/authCookie.js';

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const cookieToken = req.cookies?.[getAuthCookieName()];

  if (!auth && !cookieToken) {
    return res.status(401).json({
      message: 'Token não informado',
    });
  }

  const token = cookieToken || (
    typeof auth === 'string' && auth.startsWith('Bearer ')
      ? auth.slice(7)
      : null
  );
  if (!token) {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'tijucas-imobiliaria',
      audience: process.env.JWT_AUDIENCE || 'tijucas-imobiliaria-app',
    });

    const currentUser = await UsersRepository.getUserById({
      userId: payload.userId,
    });

    if (
      !currentUser ||
      currentUser.ativo === false ||
      Number(payload.authVersion ?? -1) !== Number(currentUser.auth_version ?? 0)
    ) {
      return res.status(401).json({
        message: 'Token inválido ou expirado',
      });
    }

    // Papel e e-mail vêm do banco, evitando privilégios obsoletos em um JWT
    // emitido antes de desativação/rebaixamento do usuário.
    req.user = {
      ...payload,
      userId: currentUser.id,
      email: currentUser.email,
      perfil: currentUser.perfil,
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      message: 'Token inválido ou expirado',
    });
  }
}
