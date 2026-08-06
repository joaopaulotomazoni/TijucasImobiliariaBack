import test from 'node:test';
import assert from 'node:assert/strict';

test('lote gera 12 cobranças e normaliza o ID usado na idempotência', async () => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY ||= 'test-key';
  process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

  const { default: BillingService } = await import(
    '../src/services/billing.service.js'
  );
  const { default: BillingRepository } = await import(
    '../src/repositories/billing.repository.js'
  );
  const { default: gatewayFactory } = await import(
    '../src/gateways/gatewayFactory.js'
  );
  const { dataAtualIso } = await import('../src/utils/businessDays.js');
  const original = {
    withContratoBillingLock: BillingRepository.withContratoBillingLock,
    getContratoParaCobranca: BillingRepository.getContratoParaCobranca,
    parcelaJaExiste: BillingRepository.parcelaJaExiste,
    criarParcelaComCobranca: BillingRepository.criarParcelaComCobranca,
    getOrCreateGatewayCustomer:
      BillingRepository.getOrCreateGatewayCustomer,
    marcarCobrancasIniciaisConcluidas:
      BillingRepository.marcarCobrancasIniciaisConcluidas,
    resolve: gatewayFactory.resolve,
  };
  const competencias = new Set();
  const references = [];
  let conclusoesLoteInicial = 0;
  const contrato = {
    id: '1',
    status: 'ATIVO',
    valor_aluguel: '1000.00',
    comissao_tipo: 'PERCENTUAL',
    taxa_administracao_percentual: '10.00',
    comissao_valor_fixo: null,
    dia_vencimento: 10,
    data_inicio: '2025-01-01',
    data_fim: '2027-12-31',
    cobrancas_iniciais_a_partir_de: '2026-01-01',
    cobrancas_iniciais_concluidas_em: null,
    valor_condominio: '0.00',
    valor_iptu: '0.00',
    proprietario_id: '2',
    pagador_usuario_id: '3',
    pagador_nome: 'Cliente Teste',
    pagador_documento: '12345678901',
    pagador_email: 'cliente@example.com',
    pagador_telefone: '48999999999',
  };

  try {
    BillingRepository.withContratoBillingLock = async (_id, callback) =>
      callback({
        query: async () => ({ rows: [] }),
      });
    BillingRepository.getContratoParaCobranca = async () => contrato;
    BillingRepository.parcelaJaExiste = async (_id, competencia) =>
      competencias.has(competencia);
    BillingRepository.criarParcelaComCobranca = async (input) => {
      competencias.add(input.competencia);
      references.push(input.externalReference);
      return { id: competencias.size, ...input };
    };
    BillingRepository.getOrCreateGatewayCustomer = async (
      _client,
      { createExternalCustomer }
    ) =>
      (await createExternalCustomer())?.externalCustomerId ??
      'fake_customer_3';
    BillingRepository.marcarCobrancasIniciaisConcluidas = async () => {
      conclusoesLoteInicial += 1;
      contrato.cobrancas_iniciais_concluidas_em =
        '2026-01-01T00:00:00.000Z';
    };
    gatewayFactory.resolve = () => ({
      provider: 'FAKE',
      supportsIdempotentChargeCreation: true,
      ensureCustomer: async () => ({
        externalCustomerId: 'fake_customer_3',
      }),
      createCharge: async ({ externalReference }) => ({
        externalPaymentId: `pay-${externalReference}`,
        statusGateway: 'PENDING',
      }),
    });

    const first = await BillingService.gerarCobrancasDoContrato('01');
    const retry = await BillingService.gerarCobrancasDoContrato('1', {
      aPartirDe: '2026-01-01',
    });

    assert.equal(first.geradas, 12);
    assert.equal(first.falhas.length, 0);
    assert.equal(first.itens[0].competencia, '2026-01-01');
    assert.equal(conclusoesLoteInicial, 1);
    assert.equal(retry.geradas, 0);
    assert.equal(retry.existentes, 12);
    assert.equal(references.length, 12);
    assert.ok(
      references.every((reference) => reference.startsWith('contrato-1-'))
    );

    contrato.data_inicio = '2020-01-01';
    contrato.data_fim = '9999-12-31';
    contrato.cobrancas_iniciais_a_partir_de = '2020-01-01';
    const janelaMovel =
      await BillingService.gerarCobrancasDoContrato('1');

    assert.equal(janelaMovel.solicitadas, 12);
    assert.equal(
      janelaMovel.itens[0].competencia,
      `${dataAtualIso().slice(0, 7)}-01`
    );
    assert.equal(conclusoesLoteInicial, 1);
  } finally {
    BillingRepository.withContratoBillingLock =
      original.withContratoBillingLock;
    BillingRepository.getContratoParaCobranca =
      original.getContratoParaCobranca;
    BillingRepository.parcelaJaExiste = original.parcelaJaExiste;
    BillingRepository.criarParcelaComCobranca =
      original.criarParcelaComCobranca;
    BillingRepository.getOrCreateGatewayCustomer =
      original.getOrCreateGatewayCustomer;
    BillingRepository.marcarCobrancasIniciaisConcluidas =
      original.marcarCobrancasIniciaisConcluidas;
    gatewayFactory.resolve = original.resolve;
  }
});

test('baixa presencial cancela o gateway antes de registrar pagamento auditado', async () => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY ||= 'test-key';
  process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

  const { default: BillingService } = await import('../src/services/billing.service.js');
  const { default: BillingRepository } = await import('../src/repositories/billing.repository.js');
  const { default: gatewayFactory } = await import('../src/gateways/gatewayFactory.js');
  const original = {
    getContextoBaixaManual: BillingRepository.getContextoBaixaManual,
    withContratoBillingLock: BillingRepository.withContratoBillingLock,
    iniciarBaixaManual: BillingRepository.iniciarBaixaManual,
    marcarBaixaGatewayCancelado: BillingRepository.marcarBaixaGatewayCancelado,
    marcarFalhaBaixaManual: BillingRepository.marcarFalhaBaixaManual,
    finalizarBaixaManual: BillingRepository.finalizarBaixaManual,
    resolve: gatewayFactory.resolve,
  };
  const events = [];
  const client = { query: async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') events.push(sql);
    return { rows: [] };
  } };
  const context = {
    parcela_id: '4', contrato_id: '2', parcela_status: 'ABERTA',
    valor_total: '1250.00', gateway_cobranca_id: '8', gateway: 'ASAAS',
    external_payment_id: 'pay_8', ativa: true, baixa_status: null,
  };

  try {
    BillingRepository.getContextoBaixaManual = async () => context;
    BillingRepository.withContratoBillingLock = async (_id, callback) => callback(client);
    BillingRepository.iniciarBaixaManual = async (_client, data) => {
      events.push(['AUDIT', data]);
      return { id: '10', status: 'INICIADA' };
    };
    BillingRepository.marcarBaixaGatewayCancelado = async () => events.push('GATEWAY_CANCELADO');
    BillingRepository.marcarFalhaBaixaManual = async () => events.push('FALHA');
    BillingRepository.finalizarBaixaManual = async () => {
      events.push('PAGAMENTO_PRESENCIAL');
      return { id: '10', status: 'CONCLUIDA' };
    };
    gatewayFactory.resolve = () => ({
      cancelCharge: async (id) => events.push(['CANCEL_ASAAS', id]),
    });

    const result = await BillingService.registrarBaixaManual('4', {
      valorPago: 1250,
      dataPagamento: '2026-08-16',
      formaPagamento: 'DINHEIRO',
    }, '7');

    assert.equal(result.status, 'CONCLUIDA');
    assert.deepEqual(events[0][0], 'AUDIT');
    assert.equal(events[0][1].valorPago, 1250);
    assert.deepEqual(events[1], ['CANCEL_ASAAS', 'pay_8']);
    assert.equal(events[2], 'GATEWAY_CANCELADO');
    assert.equal(events.at(-2), 'PAGAMENTO_PRESENCIAL');
    assert.equal(events.at(-1), 'COMMIT');
  } finally {
    BillingRepository.getContextoBaixaManual = original.getContextoBaixaManual;
    BillingRepository.withContratoBillingLock = original.withContratoBillingLock;
    BillingRepository.iniciarBaixaManual = original.iniciarBaixaManual;
    BillingRepository.marcarBaixaGatewayCancelado = original.marcarBaixaGatewayCancelado;
    BillingRepository.marcarFalhaBaixaManual = original.marcarFalhaBaixaManual;
    BillingRepository.finalizarBaixaManual = original.finalizarBaixaManual;
    gatewayFactory.resolve = original.resolve;
  }
});
