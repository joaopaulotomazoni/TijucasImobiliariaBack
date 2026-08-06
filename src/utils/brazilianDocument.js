function allEqual(value) {
  return /^(\d)\1+$/.test(value);
}

function checkDigit(base, weights) {
  const sum = base
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpfCnpj(input) {
  const value = String(input ?? '').replace(/\D/g, '');
  if (allEqual(value)) return false;
  if (value.length === 11) {
    const first = checkDigit(value.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = checkDigit(
      value.slice(0, 9) + first,
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]
    );
    return value.endsWith(`${first}${second}`);
  }
  if (value.length === 14) {
    const first = checkDigit(
      value.slice(0, 12),
      [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    );
    const second = checkDigit(
      value.slice(0, 12) + first,
      [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    );
    return value.endsWith(`${first}${second}`);
  }
  return false;
}
