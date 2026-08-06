import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Configure DATABASE_URL para aplicar as migrations.');
}

const migrationsDir = path.resolve('docs/migrations');
const files = (await fs.readdir(migrationsDir))
  .filter((file) => /^\d{3}_.+\.sql$/.test(file))
  .sort();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const filename of files) {
    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const tracked = await pool.query(
      'SELECT checksum FROM public.schema_migrations WHERE filename = $1',
      [filename]
    );

    if (tracked.rows[0]) {
      if (tracked.rows[0].checksum !== checksum) {
        throw new Error(`A migration ${filename} mudou depois de aplicada.`);
      }
      console.log(`[skip] ${filename}`);
      continue;
    }

    // As migrations 001–004 são anteriores ao rastreamento. Em bancos
    // existentes, os marcadores estruturais permitem registrá-las sem
    // executar novamente SQL não idempotente.
    const legacyMarkers = {
      '001_garantias.sql': "to_regclass('public.garantias') IS NOT NULL",
      '002_imoveis_observacoes.sql':
        "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='imoveis' AND column_name='observacoes')",
      '003_garantia_caucao_comprovante.sql':
        "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='garantia_caucao' AND column_name='comprovante_deposito_key')",
      '004_financeiro.sql':
        "to_regclass('public.webhook_events') IS NOT NULL AND to_regclass('public.parcelas') IS NOT NULL",
      '005_fluxo_boletos_lote.sql':
        "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='webhook_events' AND column_name='tentativas')",
      '006_inquilino_principal.sql':
        "to_regclass('public.contrato_inquilinos') IS NOT NULL AND to_regclass('public.uq_inquilino_principal') IS NOT NULL",
      '007_gestao_documental_e_baixas.sql':
        "to_regclass('public.cliente_documentos') IS NOT NULL AND to_regclass('public.caucao_cobrancas') IS NOT NULL AND to_regclass('public.baixas_manuais') IS NOT NULL",
    };
    const marker = legacyMarkers[filename];
    if (marker) {
      const present = await pool.query(`SELECT ${marker} AS present`);
      if (present.rows[0].present) {
        await pool.query(
          'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum]
        );
        console.log(`[track existing] ${filename}`);
        continue;
      }
    }

    // O próprio arquivo controla a transação quando necessário.
    await pool.query(sql);
    await pool.query(
      'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, checksum]
    );
    console.log(`[applied] ${filename}`);
  }
} finally {
  await pool.end();
}
