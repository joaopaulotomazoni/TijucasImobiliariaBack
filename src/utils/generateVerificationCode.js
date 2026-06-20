import { customAlphabet } from 'nanoid';

/**
 * Gera um código numérico de 6 dígitos para verificação (ex: "492015")
 */
export function generateVerificationCode() {
  const nanoidCode = customAlphabet('0123456789', 6);
  return nanoidCode();
}
