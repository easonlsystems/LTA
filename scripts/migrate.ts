import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidateDirs=[path.resolve(process.cwd(),'sql'),path.resolve(here,'../../sql'),path.resolve(here,'../sql')];
let sqlDir:string|undefined;
for(const candidate of candidateDirs){
  try{const stat=await fs.stat(candidate);if(stat.isDirectory()){sqlDir=candidate;break;}}catch{}
}
if(!sqlDir)throw new Error('Could not find sql migration directory');
const migrationFiles=(await fs.readdir(sqlDir)).filter(name=>/^\d+.*\.sql$/i.test(name)).sort();
if(!migrationFiles.length)throw new Error('No SQL migration files found');
const sql=(await Promise.all(migrationFiles.map(async name=>`-- ${name}\n${await fs.readFile(path.join(sqlDir!,name),'utf8')}`))).join('\n\n');
const client=await pool.connect();
try{
  await client.query('BEGIN');
  // API and Worker can deploy at the same time on Railway. Serializing migration avoids
  // concurrent ALTER/DROP/ADD races while keeping one shared migration entrypoint.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('link2ai:migrate:v1'))");
  await client.query(sql);
  await client.query('COMMIT');
  console.log(`Link2AI database migration complete (${migrationFiles.join(', ')}).`);
}catch(err){
  await client.query('ROLLBACK').catch(()=>{});
  throw err;
}finally{
  client.release();
  await pool.end();
}