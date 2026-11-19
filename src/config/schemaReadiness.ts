import { pool } from '../db/pool.js';

// These columns are required by the current worker and API job/cache contracts.
// A plain SELECT 1 can succeed while one service is still serving an older schema.
export async function schemaReady():Promise<boolean>{
  const result=await pool.query(`
    SELECT
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.transcript_jobs') AND attname = 'error_cause_code' AND NOT attisdropped) AS job_cause,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.transcript_cache') AND attname = 'media_validated' AND NOT attisdropped) AS media_validation
  `);
  return result.rows[0]?.job_cause===true&&result.rows[0]?.media_validation===true;
}
