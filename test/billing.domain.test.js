import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularComissao,
  calcularValorRepasse,
  montarLancamentos,
} from '../src/services/billing.domain.js';

test('calcula comissão com o formato snake_case retornado pelo PostgreSQL', () => {
  assert.equal(
    calcularComissao({
      comissao_tipo: 'PERCENTUAL',
      taxa_administracao_percentual: '10.00',
      valor_aluguel: '1000.00',
    }),
    100
  );
});

test('arredonda valor monetário de meia casa para cima', () => {
  assert.equal(
    calcularComissao({
      comissao_tipo: 'PERCENTUAL',
      taxa_administracao_percentual: '1.00',
      valor_aluguel: '100.50',
    }),
    1.01
  );
});

test('não perde centavo em percentual representado de forma inexata no IEEE-754', () => {
  assert.equal(
    calcularComissao({
      comissao_tipo: 'PERCENTUAL',
      taxa_administracao_percentual: '10.00',
      valor_aluguel: '100.75',
    }),
    10.08
  );
});

test('repasse aceita valor_base no formato do repositório', () => {
  const lancamentos = montarLancamentos({
    valorCondominio: 0,
    valorIptu: 0,
    comissao: 100,
  });

  assert.equal(
    calcularValorRepasse({ valor_base: '1000.00', lancamentos }),
    900
  );
});
