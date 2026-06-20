import AppError from '../errors/AppError.js';

const STAFF_ROLES = ['ADMIN', 'CORRETOR'];

export function verifyEmployee(req, res, next) {
  try {
    const perfil = req.user?.perfil;

    if (!perfil) {
      throw new AppError('Perfil não encontrado no token.', 401);
    }

    if (!STAFF_ROLES.includes(perfil)) {
      return res.status(403).json({
        status: 'error',
        message: 'Acesso negado. Permissão de funcionário necessária.',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
