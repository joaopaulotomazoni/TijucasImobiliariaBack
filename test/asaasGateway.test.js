import test from 'node:test';
import assert from 'node:assert/strict';
import { AsaasGateway } from '../src/gateways/asaasGateway.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('adapter Asaas cria pagador e emite boleto com dados de pagamento', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    const method = options.method;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: parsed.pathname, method, body });

    if (parsed.pathname.endsWith('/customers') && method === 'GET') {
      return jsonResponse({ data: [] });
    }
    if (parsed.pathname.endsWith('/customers') && method === 'POST') {
      return jsonResponse({ id: 'cus_123' });
    }
    if (parsed.pathname.endsWith('/payments') && method === 'GET') {
      return jsonResponse({ data: [] });
    }
    if (parsed.pathname.endsWith('/payments') && method === 'POST') {
      return jsonResponse({
        id: 'pay_123',
        customer: body.customer,
        value: body.value,
        dueDate: body.dueDate,
        status: 'PENDING',
        bankSlipUrl: 'https://sandbox.asaas.com/b/pay_123',
        invoiceUrl: 'https://sandbox.asaas.com/i/pay_123',
      });
    }
    if (parsed.pathname.endsWith('/identificationField')) {
      return jsonResponse({
        identificationField: '00190000000000000000',
        barCode: '001900000000000000000000',
      });
    }
    if (parsed.pathname.endsWith('/pixQrCode')) {
      return jsonResponse({
        encodedImage: 'base64-image',
        payload: 'pix-copy-paste',
      });
    }

    throw new Error(`Chamada inesperada: ${method} ${url}`);
  };
  const gateway = new AsaasGateway({
    apiKey: 'sandbox-key',
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    fetchImpl,
    allowBestEffortChargeCreation: true,
  });
  const customer = await gateway.ensureCustomer({
    usuarioId: '7',
    nome: 'Cliente Teste',
    documento: '123.456.789-01',
    email: 'cliente@example.com',
    telefone: '(48) 99999-9999',
  });
  const charge = await gateway.createCharge({
    customerId: customer.externalCustomerId,
    valor: 100.75,
    dataVencimento: '2026-09-05',
    externalReference: 'contrato-11-2026-09-01',
    descricao: 'Aluguel',
  });

  assert.equal(customer.externalCustomerId, 'cus_123');
  assert.equal(charge.externalPaymentId, 'pay_123');
  assert.equal(charge.linhaDigitavel, '00190000000000000000');
  assert.equal(charge.copiaColaPix, 'pix-copy-paste');

  const customerPost = calls.find(
    (call) => call.path.endsWith('/customers') && call.method === 'POST'
  );
  const paymentPost = calls.find(
    (call) => call.path.endsWith('/payments') && call.method === 'POST'
  );
  assert.equal(customerPost.body.externalReference, 'usuario-7');
  assert.equal(customerPost.body.cpfCnpj, '12345678901');
  assert.equal(paymentPost.body.customer, 'cus_123');
  assert.equal(paymentPost.body.externalReference, 'contrato-11-2026-09-01');
});

test('adapter Asaas recupera cobrança idempotente por externalReference', async () => {
  let postCount = 0;
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith('/payments') && options.method === 'GET') {
      return jsonResponse({
        data: [
          {
            id: 'pay_existing',
            customer: 'cus_existing',
            value: 50,
            dueDate: '2026-10-05',
            status: 'PENDING',
            invoiceUrl: 'https://sandbox.asaas.com/i/pay_existing',
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/identificationField')) {
      return jsonResponse({ identificationField: 'linha', barCode: 'barra' });
    }
    if (parsed.pathname.endsWith('/pixQrCode')) {
      return jsonResponse({ payload: 'pix' });
    }
    if (options.method === 'POST') {
      postCount += 1;
    }
    throw new Error(`Chamada inesperada: ${options.method} ${url}`);
  };
  const gateway = new AsaasGateway({
    apiKey: 'sandbox-key',
    fetchImpl,
    allowBestEffortChargeCreation: true,
  });
  const charge = await gateway.createCharge({
    customerId: 'cus_existing',
    valor: '50.00',
    dataVencimento: '2026-10-05',
    externalReference: 'contrato-11-2026-10-01',
  });

  assert.equal(charge.externalPaymentId, 'pay_existing');
  assert.equal(postCount, 0);
});

test('adapter Asaas declara best-effort e bloqueia criação por padrão', async () => {
  const previousOptIn =
    process.env.ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION;
  delete process.env.ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION;
  let requestCount = 0;
  const gateway = new AsaasGateway({
    apiKey: 'sandbox-key',
    fetchImpl: async () => {
      requestCount += 1;
      throw new Error('Não deveria chamar o Asaas');
    },
  });

  try {
    assert.equal(gateway.supportsIdempotentChargeCreation, false);
    assert.equal(
      gateway.chargeCreationSafetyMode,
      'BEST_EFFORT_EXTERNAL_REFERENCE'
    );
    await assert.rejects(
      gateway.createCharge({
        customerId: 'cus_123',
        valor: 100,
        dataVencimento: '2026-09-05',
        externalReference: 'contrato-11-2026-09-01',
      }),
      /deduplicação best-effort/
    );
    assert.equal(requestCount, 0);
  } finally {
    if (previousOptIn === undefined) {
      delete process.env.ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION;
    } else {
      process.env.ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION =
        previousOptIn;
    }
  }
});

test('adapter Asaas emite cobrança Pix e trata cancelamento repetido como sucesso', async () => {
  let paymentBody;
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/payments') && options.method === 'GET') {
      return jsonResponse({ data: [] });
    }
    if (parsed.pathname.endsWith('/payments') && options.method === 'POST') {
      paymentBody = JSON.parse(options.body);
      return jsonResponse({
        id: 'pay_pix', customer: paymentBody.customer,
        value: paymentBody.value, dueDate: paymentBody.dueDate,
        status: 'PENDING',
      });
    }
    if (parsed.pathname.endsWith('/identificationField')) {
      return jsonResponse({}, 404);
    }
    if (parsed.pathname.endsWith('/pixQrCode')) {
      return jsonResponse({ encodedImage: 'pix-image', payload: 'pix-payload' });
    }
    if (parsed.pathname.endsWith('/pay_pix') && options.method === 'DELETE') {
      return jsonResponse({ errors: [{ description: 'Pagamento inexistente.' }] }, 404);
    }
    throw new Error(`Chamada inesperada: ${options.method} ${url}`);
  };
  const gateway = new AsaasGateway({
    apiKey: 'sandbox-key', fetchImpl, allowBestEffortChargeCreation: true,
  });
  const charge = await gateway.createCharge({
    customerId: 'cus_pix', valor: 3000, dataVencimento: '2026-08-16',
    externalReference: 'caucao-9', billingType: 'PIX',
  });
  const cancelled = await gateway.cancelCharge('pay_pix');

  assert.equal(paymentBody.billingType, 'PIX');
  assert.equal(charge.linhaDigitavel, null);
  assert.equal(charge.copiaColaPix, 'pix-payload');
  assert.deepEqual(cancelled, { status: 'CANCELLED' });
});
