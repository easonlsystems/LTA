import { pool } from '../db/pool.js';

export async function acquireMediaClaim(platform:string,canonicalMediaId:string,language:string,jobId:string):Promise<boolean>{
  await pool.query('DELETE FROM media_processing_claims WHERE expires_at<=now()');
  const r=await pool.query(
    `INSERT INTO media_processing_claims(platform,canonical_media_id,language,job_id,expires_at)
     VALUES($1,$2,$3,$4,now()+interval '15 minutes')
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       expires_at=EXCLUDED.expires_at
     WHERE media_processing_claims.job_id=EXCLUDED.job_id
     RETURNING job_id`,
    [platform,canonicalMediaId,language,jobId]
  );
  return Boolean(r.rowCount);
}

export async function releaseMediaClaim(jobId:string):Promise<void>{
  await pool.query('DELETE FROM media_processing_claims WHERE job_id=$1',[jobId]);
}

export async function heartbeatMediaClaim(jobId:string):Promise<void>{
  await pool.query(`UPDATE media_processing_claims SET expires_at=now()+interval '15 minutes' WHERE job_id=$1`,[jobId]);
}
