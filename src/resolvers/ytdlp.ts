import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { MediaMetadata } from '../media/types.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import type { ParsedMediaUrl, Platform } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';
import type { MediaResolver, ResolveContext } from './base.js';
import { validateResolvedMediaIdentity } from './identity.js';

function mapYtDlpError(stderr: string): Link2AIError {
  const s = stderr.toLowerCase();
  if (s.includes('private') || s.includes('not available') && s.includes('login')) {
    return new Link2AIError('PRIVATE_MEDIA', 'This video is not publicly accessible.', 403);
  }
  if (s.includes("confirm you're not a bot") || s.includes('confirm you’re not a bot') || s.includes('not a bot')) {
    return new Link2AIError('PLATFORM_BLOCKED', 'The platform temporarily blocked automated access to this public video.', 502, true);
  }
  if (s.includes('sign in') || s.includes('login required') || s.includes('cookies')) {
    return new Link2AIError('LOGIN_REQUIRED', 'The platform requires a login for this video.', 403);
  }
  if (s.includes('geo') || s.includes('not available in your country')) {
    return new Link2AIError('GEO_BLOCKED', 'This video is not available from the current region.', 451);
  }
  if (s.includes('429') || s.includes('too many requests') || s.includes('rate limit')) {
    return new Link2AIError('RATE_LIMITED', 'The platform is temporarily rate limiting requests.', 429, true);
  }
  if (s.includes('no video could be found in this tweet')) {
    return new Link2AIError(
      'EXTRACTION_FAILED',
      'This X post advertises attached media, but Link2AI could not verify a readable video track.',
      502,
      true,
      {cause_code:'x_video_track_not_verified'}
    );
  }
  if (s.includes('video unavailable') || s.includes('does not exist') || s.includes('404')) {
    return new Link2AIError('MEDIA_NOT_FOUND', 'The video was not found or has been removed.', 404);
  }
  if (s.includes('unsupported url')) {
    return new Link2AIError('UNSUPPORTED_URL', 'This social video URL is not supported.', 400);
  }
  return new Link2AIError('EXTRACTION_FAILED', 'Link2AI could not read this video from the platform.', 502, true, { extractor: stderr.slice(-1200) });
}

function preferredExtractionError(first:unknown,second:unknown):unknown{
  const errors=[second,first].filter((e):e is Link2AIError=>e instanceof Link2AIError);
  const definitive=errors.find(e=>['PRIVATE_MEDIA','LOGIN_REQUIRED','GEO_BLOCKED','MEDIA_NOT_FOUND','UNSUPPORTED_URL','DOWNLOAD_TOO_LARGE'].includes(e.code));
  if(definitive)return definitive;
  return second instanceof Error?second:first;
}

function normalizeEntries(value: unknown): Record<string, Array<{ url: string; ext?: string; name?: string }>> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, Array<{ url: string; ext?: string; name?: string }>> = {};
  for (const [lang, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    out[lang] = entries.slice(0,8).flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const e = entry as Record<string, unknown>;
      const url=clipExternalText(e.url,METADATA_LIMITS.subtitleUrl);
      if(!url)return [];
      return [{
        url,
        ext:clipExternalText(e.ext,METADATA_LIMITS.subtitleExt),
        name:clipExternalText(e.name,METADATA_LIMITS.subtitleName)
      }];
    });
  }
  return out;
}

async function ytdlp(args: string[], ctx: ResolveContext): Promise<{stdout:string; stderr:string}> {
  const result = await runProcess(env().YTDLP_BIN, args, { timeoutMs: ctx.timeoutMs, maxOutputBytes: 20_000_000 });
  if (result.code !== 0) throw mapYtDlpError(result.stderr || result.stdout);
  return result;
}


function parseDurationString(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parts=value.trim().split(':').map(Number);
  if (!parts.length || parts.some(v=>!Number.isFinite(v)||v<0)) return 0;
  let seconds=0;
  for (const part of parts) seconds=seconds*60+part;
  return Number.isFinite(seconds)&&seconds>0?Math.ceil(seconds):0;
}

function durationFromFragments(value: unknown): number {
  if (!Array.isArray(value) || !value.length) return 0;
  let total=0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return 0;
    const d=Number((item as Record<string,unknown>).duration ?? 0);
    if (!Number.isFinite(d)||d<=0) return 0;
    total+=d;
  }
  return total>0?Math.ceil(total):0;
}

function extractDurationSeconds(raw: Record<string, unknown>): number {
  const direct=Number(raw.duration ?? 0);
  if(Number.isFinite(direct)&&direct>0)return Math.ceil(direct);
  const fromString=parseDurationString(raw.duration_string);
  if(fromString)return fromString;

  const candidates:number[]=[];
  for (const key of ['formats','requested_formats','requested_downloads'] as const) {
    const entries=raw[key];
    if(!Array.isArray(entries))continue;
    for(const entry of entries){
      if(!entry||typeof entry!=='object')continue;
      const e=entry as Record<string,unknown>;
      const d=Number(e.duration ?? 0);
      if(Number.isFinite(d)&&d>0)candidates.push(Math.ceil(d));
      const fragmented=durationFromFragments(e.fragments);
      if(fragmented)candidates.push(fragmented);
    }
  }

  if(Array.isArray(raw.chapters)){
    for(const chapter of raw.chapters){
      if(!chapter||typeof chapter!=='object')continue;
      const end=Number((chapter as Record<string,unknown>).end_time ?? 0);
      if(Number.isFinite(end)&&end>0)candidates.push(Math.ceil(end));
    }
  }
  return candidates.length?Math.max(...candidates):0;
}

export class YtDlpResolver implements MediaResolver {
  constructor(public readonly platform: Platform) {}

  async resolveMetadata(input: ParsedMediaUrl, ctx: ResolveContext): Promise<MediaMetadata> {
    let result;
    try {
      result = await ytdlp(['--js-runtimes','node','--dump-single-json','--skip-download','--no-playlist','--no-warnings', input.normalizedUrl], ctx);
    } catch (firstError) {
      // Second direct extraction path: browser impersonation where supported by current yt-dlp build.
      try {
        result = await ytdlp(['--js-runtimes','node','--impersonate','chrome','--dump-single-json','--skip-download','--no-playlist','--no-warnings', input.normalizedUrl], ctx);
      } catch (secondError) {
        throw preferredExtractionError(firstError,secondError);
      }
    }
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(result.stdout) as Record<string, unknown>; }
    catch { throw new Link2AIError('EXTRACTION_FAILED', 'Platform metadata was not valid JSON.', 502, true); }

    // Instagram and some short-form extractors occasionally return usable media metadata
    // without a top-level duration. Keep the metadata and let the worker derive a
    // definitive duration from captions or the downloaded audio before reserving quota.
    const duration = extractDurationSeconds(raw);
    const id = clipExternalText(String(raw.id ?? ''),METADATA_LIMITS.canonicalId);
    if(!id)throw new Link2AIError('EXTRACTION_FAILED','The platform returned an invalid media id.',502,true);
    const webpageUrl=clipExternalText(raw.webpage_url,METADATA_LIMITS.subtitleUrl);
    validateResolvedMediaIdentity(input,id,webpageUrl);
    return {
      platform: this.platform,
      resolver: 'ytdlp',
      canonicalMediaId: id,
      webpageUrl: webpageUrl??input.normalizedUrl,
      originalLanguage: clipExternalText(raw.language,METADATA_LIMITS.language),
      title: clipExternalText(raw.title,METADATA_LIMITS.title),
      creator: clipExternalText(typeof raw.uploader==='string'?raw.uploader:raw.channel,METADATA_LIMITS.creator),
      description: clipExternalText(raw.description,METADATA_LIMITS.description),
      ageLimit:Number.isFinite(Number(raw.age_limit))?Math.max(0,Number(raw.age_limit)):undefined,
      durationSeconds: duration,
      subtitles: normalizeEntries(raw.subtitles),
      automaticCaptions: normalizeEntries(raw.automatic_captions)
    };
  }

  async downloadAudio(input: ParsedMediaUrl, outputDir: string, ctx: ResolveContext): Promise<string> {
    const template = path.join(outputDir, 'audio.%(ext)s');
    let result;
    try {
      result = await ytdlp([
        '--js-runtimes','node','--no-playlist','--no-warnings','-f','bestaudio/best',
        '--max-filesize', String(env().MAX_DOWNLOAD_BYTES), '-o', template, input.normalizedUrl
      ], ctx);
    } catch (firstError) {
      try {
        result = await ytdlp([
          '--impersonate','chrome','--js-runtimes','node','--no-playlist','--no-warnings','-f','bestaudio/best',
          '--max-filesize', String(env().MAX_DOWNLOAD_BYTES), '-o', template, input.normalizedUrl
        ], ctx);
      } catch (secondError) {
        throw preferredExtractionError(firstError,secondError);
      }
    }
    void result;
    const files = await fs.readdir(outputDir);
    const audio = files.find(f => f.startsWith('audio.'));
    if (!audio) throw new Link2AIError('EXTRACTION_FAILED', 'Audio extraction completed without an output file.', 502, true);
    const fullPath = path.join(outputDir, audio);
    const stat = await fs.stat(fullPath);
    if (stat.size > env().MAX_DOWNLOAD_BYTES) {
      await fs.rm(fullPath, { force: true });
      throw new Link2AIError('DOWNLOAD_TOO_LARGE', 'The extracted audio exceeds the transcription safety limit.', 413);
    }
    return fullPath;
  }
}
