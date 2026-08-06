import { rateLimit } from 'express-rate-limit';

const base = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    status: 'error',
    message: 'Muitas tentativas. Aguarde antes de tentar novamente.',
  },
};

export const loginRateLimit = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

export const registrationRateLimit = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

export const verificationRateLimit = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

export const uploadRateLimit = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 100,
});
