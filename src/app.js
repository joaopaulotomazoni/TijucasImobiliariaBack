import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import routes from './routes/routes.js';
import AppError from './errors/AppError.js';

const app = express();

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (process.env.APP_TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new AppError('Origem não autorizada.', 403));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'asaas-access-token'],
  maxAge: 86400,
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

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
