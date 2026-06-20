import jwt from 'jsonwebtoken';

export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    return res.status(401).json({
      message: 'Token não informado',
    });
  }

  const [, token] = auth.split(' ');

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = payload;

    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Token inválido ou expirado',
    });
  }
}
