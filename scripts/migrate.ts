import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates=[path.resolve(process.cwd(),'sql/001_init.sql'),path.resolve(here,'../../sql/001_init.sql'),path.resolve(here,'../sql/001_init.sql')];
let sql:string|undefined;
for(const candidate of candidates){try{sql=await fs.readFile(candidate,'utf8');break;}catch{}}
if(!sql)throw new Error('Could not find sql/001_init.sql');
const client=await pool.connect();
try{
  await client.query('BEGIN');
  // API and Worker can deploy at the same time on Railway. Serializing migration avoids
  // concurrent ALTER/DROP/ADD races while keeping one shared migration entrypoint.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('link2ai:migrate:v1'))");
  await client.query(sql);
  await client.query('COMMIT');
  console.log('Link2AI database migration complete.');
}catch(err){
  await client.query('ROLLBACK').catch(()=>{});
  throw err;
}finally{
  client.release();
  await pool.end();
}
