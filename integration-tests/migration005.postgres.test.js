import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import pg from 'pg';

test('migration 005 aplica integralmente no estado atual do PostgreSQL', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL não configurada.');
    return;
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  const client = await pool.connect();

  try {
    const migrationUrl = new URL(
      '../docs/migrations/005_fluxo_boletos_lote.sql',
      import.meta.url
    );
    const migration = (await readFile(migrationUrl, 'utf8'))
      .replace(/^\s*BEGIN;\s*$/im, '')
      .replace(/^\s*COMMIT;\s*$/im, '');

    await client.query('BEGIN');
    await client.query(migration);

    const result = await client.query(`
      SELECT
        (SELECT confdeltype = 'r'
           FROM pg_constraint
          WHERE conname = 'parcelas_contrato_id_fkey') AS fk_restrict,
        to_regclass('public.uq_pagamento_gateway_event') IS NOT NULL
          AS pagamento_evento_unico,
        to_regclass('public.idx_parcelas_contrato_vencimento') IS NOT NULL
          AS indice_listagem,
        to_regclass('public.uq_codigo_usuario_tipo') IS NOT NULL
          AS codigo_por_finalidade,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'contratos'
            AND column_name = 'cobrancas_iniciais_concluidas_em'
        ) AS handoff_duravel,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pagamentos'
            AND column_name = 'estornado_em'
        ) AS estorno_modelado,
        (SELECT count(*) = 3
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'webhook_events'
            AND column_name IN (
              'tentativas', 'proxima_tentativa_em', 'descartado_em'
            )) AS webhook_inbox_retry,
        (SELECT pg_get_constraintdef(oid) LIKE '%DESCARTADO%'
           FROM pg_constraint
          WHERE conrelid = 'public.webhook_events'::regclass
            AND conname = 'webhook_status_chk') AS webhook_dead_letter,
        (SELECT indexdef LIKE '%(parcela_id) WHERE ativa%'
                AND indexdef NOT LIKE '%(parcela_id, gateway)%'
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'uq_gateway_cobranca_ativa')
          AS uma_cobranca_ativa
    `);

    assert.deepEqual(result.rows[0], {
      fk_restrict: true,
      pagamento_evento_unico: true,
      indice_listagem: true,
      codigo_por_finalidade: true,
      handoff_duravel: true,
      estorno_modelado: true,
      webhook_inbox_retry: true,
      webhook_dead_letter: true,
      uma_cobranca_ativa: true,
    });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
