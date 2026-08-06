import test from 'node:test';
import assert from 'node:assert/strict';

test('BillingService bloqueia Asaas best-effort por padrão e aceita opt-in explícito', async () => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY ||= 'test-key';
  process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

  const { default: BillingService } = await import(
    '../src/services/billing.service.js'
  );
  const { default: gatewayFactory } = await import(
    '../src/gateways/gatewayFactory.js'
  );
  const { AsaasGateway } = await import(
    '../src/gateways/asaasGateway.js'
  );
  const originalResolve = gatewayFactory.resolve;

  try {
    const blockedGateway = new AsaasGateway({
      apiKey: 'sandbox-key',
      fetchImpl: async () => {
        throw new Error('Não deveria chamar o Asaas');
      },
      allowBestEffortChargeCreation: false,
    });
    gatewayFactory.resolve = () => blockedGateway;

    assert.throws(
      () => BillingService.assertGatewayConfigured(),
      /ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=true/
    );

    const optedInGateway = new AsaasGateway({
      apiKey: 'sandbox-key',
      fetchImpl: async () => {
        throw new Error('Não deveria chamar o Asaas');
      },
      allowBestEffortChargeCreation: true,
    });
    gatewayFactory.resolve = () => optedInGateway;

    assert.equal(
      BillingService.assertGatewayConfigured(),
      optedInGateway
    );
  } finally {
    gatewayFactory.resolve = originalResolve;
  }
});

test('BillingService continua aceitando gateway com idempotência real', async () => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY ||= 'test-key';
  process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

  const { default: BillingService } = await import(
    '../src/services/billing.service.js'
  );
  const { default: gatewayFactory } = await import(
    '../src/gateways/gatewayFactory.js'
  );
  const originalResolve = gatewayFactory.resolve;
  const fakeGateway = {
    provider: 'FAKE',
    supportsIdempotentChargeCreation: true,
    validateConfiguration() {},
    async ensureCustomer() {
      return { externalCustomerId: 'fake_customer_1' };
    },
  };

  try {
    gatewayFactory.resolve = () => fakeGateway;
    assert.equal(BillingService.assertGatewayConfigured(), fakeGateway);
  } finally {
    gatewayFactory.resolve = originalResolve;
  }
});
