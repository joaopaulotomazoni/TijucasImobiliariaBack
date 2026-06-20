import { ZodError } from 'zod';
import AppError from '../errors/AppError.js';

export default function errorHandler(err, request, response, next) {
  // Se o erro for do Zod (validação)
  if (err instanceof ZodError) {
    return response.status(400).json({
      status: 'error',
      message: 'Erro de validação.',
      issues: err.flatten().fieldErrors,
    });
  }

  // Se o erro for um AppError (nosso erro personalizado)
  if (err instanceof AppError) {
    return response.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      issues: err.issues.length > 0 ? err.issues : undefined,
    });
  }

  // Para outros erros (erros de banco de dados, sintaxe, etc.)
  console.error('Erro Interno:', err);

  return response.status(500).json({
    status: 'error',
    message: 'Erro interno do servidor.',
  });
}
