import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { MediaMetadata } from '../media/types.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import type { ParsedMediaUrl, Platform } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';
import type { MediaResolver, ResolveContext } from './base.js';

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

    const duration = Math.max(0, Math.round(Number(raw.duration ?? 0)));
    if (!duration) throw new Link2AIError('EXTRACTION_FAILED', 'The video duration could not be determined.', 502, true);
    const id = clipExternalText(String(raw.id ?? input.canonicalMediaId),METADATA_LIMITS.canonicalId);
    if(!id)throw new Link2AIError('EXTRACTION_FAILED','The platform returned an invalid media id.',502,true);
    return {
      platform: this.platform,
      resolver: 'ytdlp',
      canonicalMediaId: id,
      webpageUrl: input.normalizedUrl,
      originalLanguage: clipExternalText(raw.language,METADATA_LIMITS.language),
      title: clipExternalText(raw.title,METADATA_LIMITS.title),
      creator: clipExternalText(typeof raw.uploader==='string'?raw.uploader:raw.channel,METADATA_LIMITS.creator),
      description: clipExternalText(raw.description,METADATA_LIMITS.description),
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
      throw new Link2AIError('DOWNLOAD_TOO_LARGE', 'The extracted audio exceeds the V1 safety limit.', 413);
    }
    return fullPath;
  }
}
