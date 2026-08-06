import { calcularValorCobranca } from './billing.domain.js';
import { proximoDiaUtil } from '../utils/businessDays.js';
import { centsToNumber, roundMoney, toCents } from '../utils/money.js';

const STATUS_EM_ABERTO = new Set(['ABERTA', 'PENDENTE', 'PARCIAL', 'VENCIDA']);
const STATUS_PAGOS_PARA_CLIENTE = new Set([
  'RECEBIDA',
  'PAGA',
  'REPASSADA',
]);

export function resumirParcelaParaCliente(parcela, hoje) {
  const valorCalculado = calcularValorCobranca({
    valorBase: parcela.valor_base,
    lancamentos: parcela.lancamentos,
  });
  const valorTotal = roundMoney(parcela.cobranca?.valor ?? valorCalculado);
  const valorPagoCentavos = parcela.pagamentos.reduce(
    (sum, item) => sum + toCents(item.valor_pago),
    0n
  );
  const valorPago = centsToNumber(valorPagoCentavos);
  const saldoCentavos = toCents(valorTotal) - valorPagoCentavos;
  const dataVencimentoEfetiva = proximoDiaUtil(parcela.data_vencimento);
  const isVencida =
    STATUS_EM_ABERTO.has(parcela.status) &&
    dataVencimentoEfetiva < hoje;
  const statusEfetivo = STATUS_PAGOS_PARA_CLIENTE.has(parcela.status)
    ? 'PAGA'
    : isVencida
      ? 'VENCIDA'
      : parcela.status === 'PENDENTE'
        ? 'ABERTA'
        : parcela.status;

  return {
    ...parcela,
    valorTotal,
    valorPago,
    saldo: centsToNumber(saldoCentavos > 0n ? saldoCentavos : 0n),
    dataVencimentoEfetiva,
    statusEfetivo,
  };
}

/**
 * Prioriza o próximo boleto em aberto a vencer. Depois vêm os demais futuros,
 * os vencidos do mais recente para o mais antigo e, por fim, o histórico.
 */
export function ordenarParcelasDoCliente(parcelas, hoje) {
  return [...parcelas].sort((first, second) => {
    const firstOpen = STATUS_EM_ABERTO.has(first.statusEfetivo);
    const secondOpen = STATUS_EM_ABERTO.has(second.statusEfetivo);
    const firstFuture = firstOpen && first.dataVencimentoEfetiva >= hoje;
    const secondFuture = secondOpen && second.dataVencimentoEfetiva >= hoje;
    const firstOverdue = firstOpen && !firstFuture;
    const secondOverdue = secondOpen && !secondFuture;

    const firstGroup = firstFuture ? 0 : firstOverdue ? 1 : 2;
    const secondGroup = secondFuture ? 0 : secondOverdue ? 1 : 2;

    if (firstGroup !== secondGroup) {
      return firstGroup - secondGroup;
    }

    if (firstGroup === 0) {
      return first.dataVencimentoEfetiva.localeCompare(
        second.dataVencimentoEfetiva
      );
    }

    return second.data_vencimento.localeCompare(first.data_vencimento);
  });
}
