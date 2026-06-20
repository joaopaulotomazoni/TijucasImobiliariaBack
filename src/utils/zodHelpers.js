import { z } from 'zod';

/**
 * Envolve um schema numérico do Zod tratando string vazia / null / undefined
 * como ausente (undefined) e convertendo string numérica para Number antes de
 * validar. Usado para campos de formulário que chegam como '' quando em branco.
 */
export const toNumber = (schema) =>
  z.preprocess((value) => {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }

    return typeof value === 'string' ? Number(value) : value;
  }, schema);
