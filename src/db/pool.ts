import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: env().DATABASE_URL,
  max: env().NODE_ENV === 'test' ? 4 : 15,
  ssl: env().NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});
