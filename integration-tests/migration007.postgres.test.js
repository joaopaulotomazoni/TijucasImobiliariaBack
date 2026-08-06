import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import pg from 'pg';

test('migration 007 cria gestão documental, caução Pix e auditoria manual', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL não configurada.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    const url = new URL('../docs/migrations/007_gestao_documental_e_baixas.sql', import.meta.url);
    const sql = (await readFile(url, 'utf8'))
      .replace(/^\s*BEGIN;\s*$/im, '')
      .replace(/^\s*COMMIT;\s*$/im, '');
    await client.query('BEGIN');
    await client.query(sql);
    const { rows } = await client.query(`
      SELECT
        to_regclass('public.cliente_documentos') IS NOT NULL AS documentos,
        to_regclass('public.notificacoes') IS NOT NULL AS notificacoes,
        to_regclass('public.caucao_cobrancas') IS NOT NULL AS caucao_pix,
        to_regclass('public.baixas_manuais') IS NOT NULL AS baixas,
        EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='imoveis' AND column_name='numero_referencia') AS referencia_imovel,
        to_regclass('public.uq_imoveis_numero_referencia') IS NOT NULL AS referencia_imovel_unica,
        EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='pagamentos' AND column_name='origem') AS origem_pagamento,
        EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='garantia_fiadores' AND column_name='certidao_imovel_key') AS certidao_fiador
    `);
    assert.deepEqual(rows[0], {
      documentos: true,
      notificacoes: true,
      caucao_pix: true,
      baixas: true,
      referencia_imovel: true,
      referencia_imovel_unica: true,
      origem_pagamento: true,
      certidao_fiador: true,
    });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
