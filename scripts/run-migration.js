import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const migrationsRoot = path.join(projectRoot, 'docs', 'migrations');
const requested = process.argv[2];

if (!requested || !process.env.DATABASE_URL) {
  throw new Error('Informe a migration e configure DATABASE_URL.');
}

const migrationPath = path.resolve(projectRoot, requested);

if (
  !migrationPath.startsWith(`${migrationsRoot}${path.sep}`) ||
  path.extname(migrationPath) !== '.sql'
) {
  throw new Error('A migration deve estar dentro de docs/migrations.');
}

const filename = path.basename(migrationPath);
const source = await readFile(migrationPath, 'utf8');
const checksum = createHash('sha256').update(source).digest('hex');
const sql = source
  .replace(/^\s*BEGIN;\s*$/im, '')
  .replace(/^\s*COMMIT;\s*$/im, '');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const previous = await client.query(
    `SELECT checksum FROM public.schema_migrations WHERE filename = $1`,
    [filename]
  );

  if (previous.rows[0]) {
    if (previous.rows[0].checksum !== checksum) {
      throw new Error(
        `A migration ${filename} já foi aplicada com outro checksum.`
      );
    }

    console.log(`Migration já aplicada: ${filename}`);
  } else {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO public.schema_migrations (filename, checksum)
       VALUES ($1, $2)`,
      [filename, checksum]
    );
    await client.query('COMMIT');
    console.log(`Migration aplicada: ${filename}`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
