import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SECRET_KEY ||= 'test-key';
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

const { default: WebhooksController } = await import(
  '../src/controllers/webhooks.controller.js'
);
const { default: WebhooksService } = await import(
  '../src/services/webhooks.service.js'
);

function responseStub() {
  return {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('webhook Asaas falha fechado sem token configurado', async () => {
  const previous = process.env.ASAAS_WEBHOOK_TOKEN;
  delete process.env.ASAAS_WEBHOOK_TOKEN;
  const response = responseStub();

  try {
    await WebhooksController.receberAsaas(
      { headers: {}, body: {} },
      response,
      () => undefined
    );
    assert.equal(response.statusCode, 503);
  } finally {
    if (previous === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = previous;
  }
});

test('inbox Asaas exige o id externo do evento', async () => {
  await assert.rejects(
    WebhooksService.receberAsaas({
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_123' },
    }),
    (error) => error.statusCode === 400
  );
});

test('webhook Asaas aceita somente token correto', async () => {
  const previous = process.env.ASAAS_WEBHOOK_TOKEN;
  const originalReceive = WebhooksService.receberAsaas;
  const originalProcessById = WebhooksService.processarEventoPorId;
  const expectedToken = 'expected-token-with-at-least-32-chars';
  process.env.ASAAS_WEBHOOK_TOKEN = expectedToken;
  let received = 0;
  let processed = 0;
  WebhooksService.receberAsaas = async () => {
    received += 1;
    return { eventoId: '123', duplicado: false, status: 'RECEBIDO' };
  };
  WebhooksService.processarEventoPorId = async () => {
    processed += 1;
  };

  try {
    const unauthorized = responseStub();
    await WebhooksController.receberAsaas(
      {
        headers: { 'asaas-access-token': 'wrong-token' },
        body: {},
      },
      unauthorized,
      () => undefined
    );
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(received, 0);
    assert.equal(processed, 0);

    const authorized = responseStub();
    await WebhooksController.receberAsaas(
      {
        headers: { 'asaas-access-token': expectedToken },
        body: { id: 'evt_123', event: 'PAYMENT_RECEIVED' },
      },
      authorized,
      () => undefined
    );
    assert.equal(authorized.statusCode, 200);
    assert.equal(received, 1);
    assert.equal(processed, 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(processed, 1);
  } finally {
    WebhooksService.receberAsaas = originalReceive;
    WebhooksService.processarEventoPorId = originalProcessById;
    if (previous === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = previous;
  }
});
