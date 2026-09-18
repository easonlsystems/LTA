import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import type { TranscriptPayload } from '../media/types.js';

const X_MEDIA_AWARE_CACHE_EPOCH='2026-09-18T18:20:00.000Z';

export function cacheProvenanceEpoch(platform:string):string|null{
  return platform==='x'?X_MEDIA_AWARE_CACHE_EPOCH:null;
}

export interface CacheRow {
  id: string;
  platform: 'instagram'|'tiktok'|'youtube'|'x'|'reddit'|'bluesky'|'github'|'hackernews'|'pdf'|'web';
  canonical_media_id: string;
  language: string;
  title: string | null;
  creator: string | null;
  caption: string | null;
  duration_seconds: number;
  transcript: string;
  segments: Array<{start:number;end:number;text:string}>;
  source: 'caption'|'asr'|'post'|'page';
  truncated:boolean;
  truncation_reason:string|null;
  extracted_token_estimate:number;
  usage_units:number;
  items_available:number|null;
  items_extracted:number|null;
  pages_available:number|null;
  pages_extracted:number|null;
  content_sections_truncated:string[];
}

export async function findCache(platform: string, canonicalId: string, language: string): Promise<CacheRow | null> {
  const params: unknown[] = [platform, canonicalId];
  const clauses=['platform=$1','canonical_media_id=$2','expires_at > now()'];
  if (language !== 'auto') { params.push(language); clauses.push('language=$'+params.length); }
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){params.push(epoch);clauses.push('created_at >= $'+params.length+'::timestamptz');}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),' AND c.created_at >= $'+params.length+'::timestamptz'):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}
export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length); }
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){params.push(epoch);clauses.push(`created_at >= ${params.length}::timestamptz`);}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),` AND c.created_at >= ${params.length}::timestamptz`):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length+'::timestamptz');}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),` AND c.created_at >= ${params.length}::timestamptz`):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length); }
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){params.push(epoch);clauses.push(`created_at >= ${params.length}::timestamptz`);}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),` AND c.created_at >= ${params.length}::timestamptz`):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length+'::timestamptz'):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length); }
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){params.push(epoch);clauses.push(`created_at >= ${params.length}::timestamptz`);}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),` AND c.created_at >= ${params.length}::timestamptz`):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length+'::timestamptz');}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),` AND c.created_at >= ${params.length}::timestamptz`):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
+params.length); }
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){params.push(epoch);clauses.push(`created_at >= ${params.length}::timestamptz`);}
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const epoch=cacheProvenanceEpoch(platform);
  const provenanceClause=epoch?(params.push(epoch),` AND c.created_at >= ${params.length}::timestamptz`):'';
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()${provenanceClause}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at,
       truncated=EXCLUDED.truncated,truncation_reason=EXCLUDED.truncation_reason,
       extracted_token_estimate=EXCLUDED.extracted_token_estimate,usage_units=EXCLUDED.usage_units,
       items_available=EXCLUDED.items_available,items_extracted=EXCLUDED.items_extracted,
       pages_available=EXCLUDED.pages_available,pages_extracted=EXCLUDED.pages_extracted,
       content_sections_truncated=EXCLUDED.content_sections_truncated
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[])]
  );
  return r.rows[0];
}
