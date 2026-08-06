import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Configure DATABASE_URL para auditar as migrations.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.garantias') IS NOT NULL AS migration_001,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'imoveis'
          AND column_name = 'observacoes'
      ) AS migration_002,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'garantia_caucao'
          AND column_name = 'comprovante_deposito_key'
      ) AS migration_003,
      to_regclass('public.webhook_events') IS NOT NULL
        AND to_regclass('public.parcelas') IS NOT NULL AS migration_004,
      (
        SELECT count(*) = 3 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'webhook_events'
          AND column_name IN ('tentativas', 'proxima_tentativa_em', 'descartado_em')
      ) AS migration_005,
      to_regclass('public.contrato_inquilinos') IS NOT NULL
        AND to_regclass('public.uq_inquilino_principal') IS NOT NULL AS migration_006,
      to_regclass('public.cliente_documentos') IS NOT NULL
        AND to_regclass('public.caucao_cobrancas') IS NOT NULL
        AND to_regclass('public.baixas_manuais') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'pagamentos'
            AND column_name = 'origem'
        ) AS migration_007,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contratos'
          AND column_name = 'proprietario_id_snapshot'
      )
        AND to_regclass('public.uq_caucao_cobranca_ativa') IS NOT NULL
        AND to_regclass('public.cliente_documento_revisoes') IS NOT NULL
        AND to_regclass('public.garantia_auditoria') IS NOT NULL
        AS migration_008
  `);
  const tracking = await pool.query(`
    SELECT filename, applied_at
    FROM public.schema_migrations
    ORDER BY filename
  `).catch(() => ({ rows: [] }));
  console.log(JSON.stringify({ estrutura: rows[0], historico: tracking.rows }, null, 2));
  if (Object.values(rows[0]).some((applied) => applied !== true)) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
