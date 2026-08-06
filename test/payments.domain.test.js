import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ordenarParcelasDoCliente,
  resumirParcelaParaCliente,
} from '../src/services/payments.domain.js';

function parcela(overrides = {}) {
  return {
    id: 1,
    valor_base: '1000.00',
    data_vencimento: '2026-08-10',
    status: 'PENDENTE',
    cobranca: null,
    lancamentos: [],
    pagamentos: [],
    ...overrides,
  };
}

test('total do cliente não desconta a comissão interna da imobiliária', () => {
  const resumo = resumirParcelaParaCliente(
    parcela({
      lancamentos: [
        { tipo: 'CONDOMINIO', valor: '200.00' },
        { tipo: 'TAXA', valor: '-100.00' },
      ],
    }),
    '2026-08-01'
  );

  assert.equal(resumo.valorTotal, 1200);
  assert.equal(resumo.saldo, 1200);
});

test('valor persistido no gateway é a fonte do total exibido', () => {
  const resumo = resumirParcelaParaCliente(
    parcela({ cobranca: { valor: 1234.56 } }),
    '2026-08-01'
  );

  assert.equal(resumo.valorTotal, 1234.56);
});

test('parcela pendente vencida recebe status efetivo VENCIDA', () => {
  const resumo = resumirParcelaParaCliente(
    parcela({ data_vencimento: '2026-08-01' }),
    '2026-08-06'
  );

  assert.equal(resumo.statusEfetivo, 'VENCIDA');
});

test('próximo boleto a vencer aparece primeiro', () => {
  const hoje = '2026-08-06';
  const resumos = [
    parcela({ id: 1, data_vencimento: '2026-10-10' }),
    parcela({ id: 2, data_vencimento: '2026-07-10' }),
    parcela({ id: 3, data_vencimento: '2026-09-10' }),
    parcela({ id: 4, data_vencimento: '2026-08-01', status: 'PAGA' }),
  ].map((item) => resumirParcelaParaCliente(item, hoje));

  assert.deepEqual(
    ordenarParcelasDoCliente(resumos, hoje).map((item) => item.id),
    [3, 1, 2, 4]
  );
});

test('vencimento no fim de semana continua futuro até o próximo dia útil', () => {
  const resumo = resumirParcelaParaCliente(
    parcela({ data_vencimento: '2026-08-08' }),
    '2026-08-09'
  );

  assert.equal(resumo.dataVencimentoEfetiva, '2026-08-10');
  assert.equal(resumo.statusEfetivo, 'ABERTA');
});

test('status financeiro recebido é apresentado como pago ao cliente', () => {
  const resumo = resumirParcelaParaCliente(
    parcela({ status: 'RECEBIDA' }),
    '2026-08-01'
  );

  assert.equal(resumo.statusEfetivo, 'PAGA');
  assert.equal(resumo.status, 'RECEBIDA');
});

test('pagamento apenas confirmado ainda não é apresentado como pago', () => {
  const resumo = resumirParcelaParaCliente(
    parcela({ status: 'CONFIRMADA' }),
    '2026-08-01'
  );

  assert.equal(resumo.statusEfetivo, 'CONFIRMADA');
});
