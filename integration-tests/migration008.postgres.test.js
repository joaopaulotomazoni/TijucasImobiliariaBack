import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import pg from 'pg';

test('migration 008 cria snapshots, locks lógicos e auditorias', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL não configurada.');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  const client = await pool.connect();
  try {
    const url = new URL(
      '../docs/migrations/008_integridade_e_seguranca.sql',
      import.meta.url
    );
    const sql = (await readFile(url, 'utf8'))
      .replace(/^\s*BEGIN;\s*$/im, '')
      .replace(/^\s*COMMIT;\s*$/im, '');
    await client.query('BEGIN');
    await client.query(sql);
    const { rows } = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='contratos'
            AND column_name='proprietario_id_snapshot') AS snapshot,
        EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='usuarios'
            AND column_name='auth_version') AS auth_version,
        to_regclass('public.uq_caucao_cobranca_ativa') IS NOT NULL
          AS caucao_ativa,
        to_regclass('public.cliente_documento_revisoes') IS NOT NULL
          AS revisoes,
        to_regclass('public.garantia_auditoria') IS NOT NULL
          AS garantia_auditoria
    `);
    assert.deepEqual(rows[0], {
      snapshot: true,
      auth_version: true,
      caucao_ativa: true,
      revisoes: true,
      garantia_auditoria: true,
    });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
