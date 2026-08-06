import test from 'node:test';
import assert from 'node:assert/strict';
import fakeGateway, { FakeGateway } from '../src/gateways/fakeGateway.js';
import gatewayFactory from '../src/gateways/gatewayFactory.js';

test('fake gateway é idempotente por referência externa', async () => {
  const input = {
    valor: 1500,
    dataVencimento: '2026-09-10',
    externalReference: `test-${Date.now()}`,
    descricao: 'Teste',
  };

  const first = await fakeGateway.createCharge(input);
  const second = await fakeGateway.createCharge(input);

  assert.equal(second.externalPaymentId, first.externalPaymentId);
});

test('idempotência do fake gateway sobrevive a uma nova instância', async () => {
  const input = {
    valor: 900,
    dataVencimento: '2026-10-10',
    externalReference: 'contrato-1-2026-10-01',
    descricao: 'Teste de reinício',
  };

  const first = await new FakeGateway().createCharge(input);
  const afterRestart = await new FakeGateway().createCharge(input);

  assert.equal(afterRestart.externalPaymentId, first.externalPaymentId);
});

test('fake gateway rejeita reuso da referência com termos diferentes', async () => {
  const externalReference = `conflict-${Date.now()}`;
  await new FakeGateway().createCharge({
    valor: 100,
    dataVencimento: '2026-11-10',
    externalReference,
  });

  await assert.rejects(
    new FakeGateway().createCharge({
      valor: 101,
      dataVencimento: '2026-11-10',
      externalReference,
    }),
    /valor ou vencimento diferente/
  );
});

test('factory bloqueia gateway fake em produção', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProvider = process.env.PAYMENT_GATEWAY_PROVIDER;

  try {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_GATEWAY_PROVIDER = 'FAKE';
    assert.throws(() => gatewayFactory.resolve(), /não pode ser utilizado/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousProvider === undefined)
      delete process.env.PAYMENT_GATEWAY_PROVIDER;
    else process.env.PAYMENT_GATEWAY_PROVIDER = previousProvider;
  }
});
