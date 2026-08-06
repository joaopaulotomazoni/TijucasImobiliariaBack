import AppError from '../errors/AppError.js';

const POSTGRES_BIGINT_MAX = 9223372036854775807n;

export function normalizePositiveBigintId(value, label) {
  try {
    const normalized = BigInt(String(value));

    if (normalized <= 0n || normalized > POSTGRES_BIGINT_MAX) {
      throw new Error('out-of-range');
    }

    return normalized.toString();
  } catch {
    throw new AppError(`${label} deve ser um número inteiro positivo.`, 400);
  }
}
