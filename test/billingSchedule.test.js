import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MESES_COBRANCA_EM_LOTE,
  montarAgendaCobrancas,
} from '../src/services/billingSchedule.js';

test('gera no máximo 12 boletos a partir do início do contrato', () => {
  const agenda = montarAgendaCobrancas({
    dataInicio: '2026-08-01',
    dataFim: '2028-08-01',
    diaVencimento: 10,
  });

  assert.equal(agenda.length, MAX_MESES_COBRANCA_EM_LOTE);
  assert.deepEqual(agenda[0], {
    competencia: '2026-08-01',
    dataVencimento: '2026-08-10',
  });
  assert.deepEqual(agenda.at(-1), {
    competencia: '2027-07-01',
    dataVencimento: '2027-07-10',
  });
});

test('não cria boleto com vencimento anterior ao início da vigência', () => {
  const agenda = montarAgendaCobrancas({
    dataInicio: '2026-08-20',
    dataFim: '2026-11-15',
    diaVencimento: 10,
  });

  assert.deepEqual(agenda, [
    { competencia: '2026-09-01', dataVencimento: '2026-09-10' },
    { competencia: '2026-10-01', dataVencimento: '2026-10-10' },
    { competencia: '2026-11-01', dataVencimento: '2026-11-10' },
  ]);
});

test('respeita uma janela de reposição e a data final do contrato', () => {
  const agenda = montarAgendaCobrancas({
    dataInicio: '2026-01-01',
    dataFim: '2026-05-09',
    diaVencimento: 10,
    aPartirDe: '2026-03-15',
  });

  assert.deepEqual(agenda, [
    { competencia: '2026-03-01', dataVencimento: '2026-03-10' },
    { competencia: '2026-04-01', dataVencimento: '2026-04-10' },
  ]);
});

test('reconciliação recupera o vencimento faltante do mês corrente', () => {
  const agenda = montarAgendaCobrancas({
    dataInicio: '2026-07-18',
    dataFim: '2027-07-18',
    diaVencimento: 5,
    aPartirDe: '2026-08-06',
  });

  assert.deepEqual(agenda[0], {
    competencia: '2026-08-01',
    dataVencimento: '2026-08-05',
  });
  assert.equal(agenda.length, 12);
});

test('rejeita dia de vencimento fora do intervalo suportado', () => {
  assert.throws(
    () =>
      montarAgendaCobrancas({
        dataInicio: '2026-01-01',
        dataFim: '2027-01-01',
        diaVencimento: 31,
      }),
    /entre 1 e 28/
  );
});
