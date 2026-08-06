import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import pg from 'pg';

test('migration 006 exige exatamente um inquilino principal', async (t) => {
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
      '../docs/migrations/006_inquilino_principal.sql',
      import.meta.url
    );
    const migration = (await readFile(migrationUrl, 'utf8'))
      .replace(/^\s*BEGIN;\s*$/im, '')
      .replace(/^\s*COMMIT;\s*$/im, '');

    await client.query('BEGIN');
    await client.query(migration);

    const triggers = await client.query(`
      SELECT count(*)::int AS total,
             bool_and(t.tgdeferrable) AS deferrable,
             bool_and(t.tginitdeferred) AS initially_deferred
      FROM pg_trigger t
      WHERE t.tgname IN (
        'contratos_exigem_inquilino_principal',
        'contrato_inquilinos_exatamente_um_principal'
      )
        AND NOT t.tgisinternal
    `);
    assert.deepEqual(triggers.rows[0], {
      total: 2,
      deferrable: true,
      initially_deferred: true,
    });

    const principal = await client.query(`
      SELECT contrato_id, usuario_id
      FROM public.contrato_inquilinos
      WHERE principal
      ORDER BY contrato_id
      LIMIT 1
    `);

    if (principal.rows[0]) {
      const { contrato_id: contratoId, usuario_id: usuarioId } =
        principal.rows[0];

      // A troca pode passar temporariamente por zero titulares na mesma
      // transação; a validação ocorre sobre o estado final.
      await client.query('SAVEPOINT valid_final_state');
      await client.query(
        `UPDATE public.contrato_inquilinos
         SET principal = false
         WHERE contrato_id = $1 AND usuario_id = $2`,
        [contratoId, usuarioId]
      );
      await client.query(
        `UPDATE public.contrato_inquilinos
         SET principal = true
         WHERE contrato_id = $1 AND usuario_id = $2`,
        [contratoId, usuarioId]
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ROLLBACK TO SAVEPOINT valid_final_state');

      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query('SAVEPOINT invalid_final_state');
      await client.query(
        `UPDATE public.contrato_inquilinos
         SET principal = false
         WHERE contrato_id = $1 AND usuario_id = $2`,
        [contratoId, usuarioId]
      );
      await assert.rejects(
        client.query('SET CONSTRAINTS ALL IMMEDIATE'),
        (error) => error.code === '23514'
      );
      await client.query('ROLLBACK TO SAVEPOINT invalid_final_state');
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
