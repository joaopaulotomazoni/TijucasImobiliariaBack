import { toCents } from '../utils/money.js';

export function resolverTransicaoStatus(statusAtual, novoStatus) {
  if (novoStatus === 'ESTORNADA') {
    return 'ESTORNADA';
  }

  if (['ESTORNADA', 'CANCELADA'].includes(statusAtual)) {
    return statusAtual;
  }

  // Remoção atrasada no gateway não pode apagar um pagamento já reconhecido.
  if (
    novoStatus === 'CANCELADA' &&
    ['CONFIRMADA', 'PARCIAL', 'RECEBIDA', 'REPASSADA', 'PAGA'].includes(
      statusAtual
    )
  ) {
    return statusAtual;
  }

  if (
    novoStatus === 'CONFIRMADA' &&
    ['PARCIAL', 'RECEBIDA', 'REPASSADA', 'PAGA'].includes(statusAtual)
  ) {
    return statusAtual;
  }

  if (
    novoStatus === 'RECEBIDA' &&
    ['REPASSADA', 'PAGA'].includes(statusAtual)
  ) {
    return statusAtual;
  }

  if (
    novoStatus === 'PARCIAL' &&
    ['RECEBIDA', 'REPASSADA', 'PAGA'].includes(statusAtual)
  ) {
    return statusAtual;
  }

  return novoStatus;
}

export function statusDoRecebimento(valorRecebido, valorTotal) {
  return toCents(valorRecebido) >= toCents(valorTotal)
    ? 'RECEBIDA'
    : 'PARCIAL';
}
