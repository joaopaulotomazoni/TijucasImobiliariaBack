import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export default supabase;
