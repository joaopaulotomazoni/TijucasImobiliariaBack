import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import routes from './routes/routes.js';
import AppError from './errors/AppError.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use(routes);

app.use((error, request, response, next) => {
  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      issues: error.issues,
    });
  }

  if (error instanceof z.ZodError) {
    return response.status(400).json({
      status: 'error',
      message: 'Erro de validação.',
      issues: error.flatten().fieldErrors,
    });
  }

  console.error(error);

  return response.status(500).json({
    status: 'error',
    message: 'Erro interno do servidor.',
  });
});

export default app;
