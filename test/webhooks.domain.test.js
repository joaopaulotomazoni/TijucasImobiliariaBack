import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolverTransicaoStatus,
  statusDoRecebimento,
} from '../src/services/webhooks.domain.js';

test('evento CONFIRMED atrasado não regride parcela RECEBIDA', () => {
  assert.equal(
    resolverTransicaoStatus('RECEBIDA', 'CONFIRMADA'),
    'RECEBIDA'
  );
});

test('evento de estorno prevalece sobre pagamento recebido', () => {
  assert.equal(
    resolverTransicaoStatus('RECEBIDA', 'ESTORNADA'),
    'ESTORNADA'
  );
});

test('recebimento inferior ao total permanece parcial', () => {
  assert.equal(statusDoRecebimento('99.99', '100.00'), 'PARCIAL');
  assert.equal(statusDoRecebimento('100.00', '100.00'), 'RECEBIDA');
});

test('evento parcial atrasado não regride parcela recebida', () => {
  assert.equal(
    resolverTransicaoStatus('RECEBIDA', 'PARCIAL'),
    'RECEBIDA'
  );
});

test('evento confirmado atrasado não regride parcela parcial', () => {
  assert.equal(
    resolverTransicaoStatus('PARCIAL', 'CONFIRMADA'),
    'PARCIAL'
  );
});

test('remoção atrasada não apaga pagamento recebido', () => {
  assert.equal(
    resolverTransicaoStatus('RECEBIDA', 'CANCELADA'),
    'RECEBIDA'
  );
});

test('remoção de uma cobrança pendente a cancela', () => {
  assert.equal(
    resolverTransicaoStatus('PENDENTE', 'CANCELADA'),
    'CANCELADA'
  );
});
