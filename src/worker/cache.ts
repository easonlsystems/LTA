import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import type { TranscriptPayload, VisualAssetRef } from '../media/types.js';

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
  visual_assets:VisualAssetRef[];
}

const CACHE_PROVENANCE_EPOCHS:Record<string,string>={
  // Conservative production cutover: the old worker had stopped and the ChatGPT
  // endpoint was live by this point. Earlier HN cache entries may have come from
  // the previous community Algolia adapter and must never be reused.
  hackernews:'2026-09-18T18:05:44.000Z'
};

export function cacheProvenanceEpoch(platform:string):string|null{
  return CACHE_PROVENANCE_EPOCHS[platform]??null;
}

function visualPostNeedsAssets(platform:string,canonicalId:string):boolean{
  return (platform==='instagram'&&canonicalId.startsWith('post_'))
    ||(platform==='tiktok'&&canonicalId.startsWith('photo_'));
}

function validVisualPostCache(row:CacheRow|null,platform:string,canonicalId:string):CacheRow|null{
  if(!row)return null;
  if(visualPostNeedsAssets(platform,canonicalId)&&!(Array.isArray(row.visual_assets)&&row.visual_assets.length))return null;
  return row;
}

export async function findCache(platform: string, canonicalId: string, language: string): Promise<CacheRow | null> {
  const params: unknown[] = [platform, canonicalId];
  const clauses=['platform=$1','canonical_media_id=$2','expires_at > now()'];
  if (language !== 'auto') {
    params.push(language);
    clauses.push('language=$'+params.length);
  }
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){
    params.push(epoch);
    clauses.push('created_at >= $'+params.length+'::timestamptz');
  }
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return validVisualPostCache(r.rows[0]??null,platform,canonicalId);
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const params:unknown[]=[userId,platform,canonicalId];
  const clauses=["j.user_id=$1","j.platform=$2","j.canonical_media_id=$3","j.status='completed'","c.expires_at>now()"];
  const epoch=cacheProvenanceEpoch(platform);
  if(epoch){
    params.push(epoch);
    clauses.push('c.created_at >= $'+params.length+'::timestamptz');
  }
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY j.completed_at DESC LIMIT 1`,
    params
  );
  return validVisualPostCache(r.rows[0]??null,platform,canonicalId);
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  // Social image URLs are often signed CDN URLs and can expire well before the
  // normal transcript cache. Keep their cache short so a later read refreshes
  // the media references instead of handing the AI a stale image URL.
  const cacheHours=payload.visualAssets?.length?Math.min(env().TRANSCRIPT_CACHE_HOURS,1):env().TRANSCRIPT_CACHE_HOURS;
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at,truncated,truncation_reason,extracted_token_estimate,usage_units,items_available,items_extracted,pages_available,pages_extracted,content_sections_truncated,visual_assets)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb)
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,cacheHours,
     payload.completeness.truncated,payload.completeness.truncationReason??null,payload.completeness.extractedTokenEstimate,payload.completeness.usageUnits,
     payload.completeness.itemsAvailable??null,payload.completeness.itemsExtracted??null,payload.completeness.pagesAvailable??null,payload.completeness.pagesExtracted??null,
     JSON.stringify(payload.completeness.contentSectionsTruncated??[]),JSON.stringify(payload.visualAssets??[])]
  );
  return r.rows[0];
}
