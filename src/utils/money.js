function decimalParts(value, label = 'valor') {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new TypeError(`${label} deve ser um número decimal válido.`);
  }

  const fraction = match[3] ?? '';

  return {
    sign: match[1] === '-' ? -1n : 1n,
    integer: BigInt(`${match[2]}${fraction}`),
    scale: fraction.length,
  };
}

function pow10(exponent) {
  return 10n ** BigInt(exponent);
}

function divideAndRoundHalfAwayFromZero(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** Converte um decimal em centavos, arredondando meia casa para longe de zero. */
export function toCents(value, label) {
  const { sign, integer, scale } = decimalParts(value, label);
  const numerator = integer * 100n;
  const denominator = pow10(scale);

  return sign * divideAndRoundHalfAwayFromZero(numerator, denominator);
}

export function centsToNumber(cents) {
  return Number(cents) / 100;
}

export function roundMoney(value) {
  return centsToNumber(toCents(value));
}

/** Multiplica um valor monetário por um percentual sem usar ponto flutuante. */
export function percentageOfMoney(value, percentage) {
  const money = decimalParts(value, 'valor monetário');
  const rate = decimalParts(percentage, 'percentual');
  const sign = money.sign * rate.sign;
  const numerator = money.integer * rate.integer * 100n;
  const denominator = pow10(money.scale + rate.scale) * 100n;
  const cents = divideAndRoundHalfAwayFromZero(numerator, denominator);

  return centsToNumber(sign * cents);
}

export function sumMoney(values) {
  return centsToNumber(
    values.reduce((total, value) => total + toCents(value), 0n)
  );
}
