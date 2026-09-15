import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import type { TranscriptPayload } from '../media/types.js';

export interface CacheRow {
  id: string;
  platform: 'instagram'|'tiktok'|'youtube'|'x'|'reddit'|'web';
  canonical_media_id: string;
  language: string;
  title: string | null;
  creator: string | null;
  caption: string | null;
  duration_seconds: number;
  transcript: string;
  segments: Array<{start:number;end:number;text:string}>;
  source: 'caption'|'asr'|'post'|'page';
}

export async function findCache(platform: string, canonicalId: string, language: string): Promise<CacheRow | null> {
  const params: unknown[] = [platform, canonicalId];
  let langClause = '';
  if (language !== 'auto') { params.push(language); langClause = ' AND language=$3'; }
  const r = await pool.query<CacheRow>(
    `SELECT * FROM transcript_cache WHERE platform=$1 AND canonical_media_id=$2${langClause} AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return r.rows[0] ?? null;
}

export async function findUserCompletedCache(userId:string,platform:string,canonicalId:string):Promise<CacheRow|null>{
  const r=await pool.query<CacheRow>(
    `SELECT c.* FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND j.canonical_media_id=$3
       AND j.status='completed' AND c.expires_at>now()
     ORDER BY j.completed_at DESC LIMIT 1`,
    [userId,platform,canonicalId]
  );
  return r.rows[0]??null;
}

export async function saveCache(payload: TranscriptPayload): Promise<CacheRow> {
  const r = await pool.query<CacheRow>(
    `INSERT INTO transcript_cache(platform,canonical_media_id,language,title,creator,caption,duration_seconds,transcript,segments,source,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now() + ($11 || ' hours')::interval)
     ON CONFLICT(platform,canonical_media_id,language) DO UPDATE SET
       title=EXCLUDED.title, creator=EXCLUDED.creator, caption=EXCLUDED.caption,
       duration_seconds=EXCLUDED.duration_seconds, transcript=EXCLUDED.transcript, segments=EXCLUDED.segments,
       source=EXCLUDED.source, created_at=now(), expires_at=EXCLUDED.expires_at
     RETURNING *`,
    [payload.platform,payload.canonicalMediaId,payload.language,payload.title ?? null,payload.creator ?? null,
     payload.caption ?? null,payload.durationSeconds,payload.transcript,JSON.stringify(payload.segments),payload.source,env().TRANSCRIPT_CACHE_HOURS]
  );
  return r.rows[0];
}
