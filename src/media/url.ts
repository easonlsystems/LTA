import { Link2AIError } from '../util/errors.js';
import { sha256 } from '../util/crypto.js';

export type Platform = 'instagram' | 'tiktok' | 'youtube';

const allowedHosts = new Set([
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com',
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'
]);

export interface ParsedMediaUrl {
  platform: Platform;
  sourceUrl: string;
  normalizedUrl: string;
  canonicalMediaId: string;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function parseMediaUrl(raw: string): ParsedMediaUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Link2AIError('INVALID_URL', 'The provided value is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Link2AIError('INVALID_URL', 'Only HTTPS media URLs are accepted.');
  url.username = '';
  url.password = '';
  url.hash = '';
  const host = normalizeHost(url.hostname);
  if (!allowedHosts.has(host)) throw new Link2AIError('UNSUPPORTED_URL', 'This V1 service supports Instagram, TikTok and YouTube URLs only.');

  // Remove known tracking parameters but preserve media selectors such as YouTube v.
  for (const key of [...url.searchParams.keys()]) {
    if (['si','igsh','utm_source','utm_medium','utm_campaign','utm_content','utm_term','stkn','feature','share_app_id','share_item_id'].includes(key)) {
      url.searchParams.delete(key);
    }
  }

  if (host.endsWith('youtube.com') || host === 'youtu.be') return parseYouTube(raw, url);
  if (host.endsWith('instagram.com')) return parseInstagram(raw, url);
  return parseTikTok(raw, url);
}

function parseYouTube(sourceUrl: string, url: URL): ParsedMediaUrl {
  let id = '';
  if (url.hostname === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] ?? '';
  else if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
  else {
    const parts = url.pathname.split('/').filter(Boolean);
    if (['shorts','embed','live'].includes(parts[0] ?? '')) id = parts[1] ?? '';
  }
  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    throw new Link2AIError('UNSUPPORTED_URL', 'This YouTube URL does not identify a supported video.');
  }
  const normalizedUrl=`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  return { platform:'youtube', sourceUrl:normalizedUrl, canonicalMediaId:id, normalizedUrl };
}

function parseInstagram(sourceUrl: string, url: URL): ParsedMediaUrl {
  const parts = url.pathname.split('/').filter(Boolean);
  if (!['reel','reels'].includes(parts[0] ?? '') || !parts[1]) {
    throw new Link2AIError('UNSUPPORTED_URL', 'This Instagram URL is not a supported Reel/video post.');
  }
  const code = parts[1];
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(code)) throw new Link2AIError('INVALID_URL', 'Invalid Instagram media code.');
  const normalizedUrl=`https://www.instagram.com/reel/${encodeURIComponent(code)}/`;
  return { platform:'instagram', sourceUrl:normalizedUrl, canonicalMediaId:code, normalizedUrl };
}

function parseTikTok(sourceUrl: string, url: URL): ParsedMediaUrl {
  const parts = url.pathname.split('/').filter(Boolean);
  const videoIdx = parts.indexOf('video');
  if (videoIdx >= 0 && parts[videoIdx + 1] && /^\d{8,30}$/.test(parts[videoIdx + 1])) {
    const id = parts[videoIdx + 1];
    const normalizedUrl=url.origin+url.pathname;
    return { platform:'tiktok', sourceUrl:normalizedUrl, canonicalMediaId:id, normalizedUrl };
  }
  if (['vm.tiktok.com','vt.tiktok.com'].includes(url.hostname) || (['www.tiktok.com','m.tiktok.com','tiktok.com'].includes(url.hostname) && parts[0] === 't' && Boolean(parts[1]))) {
    // Short links resolve later. The hash is replaced with yt-dlp's canonical id after metadata extraction.
    const normalizedUrl=url.origin+url.pathname;
    return { platform:'tiktok', sourceUrl:normalizedUrl, canonicalMediaId:`short_${sha256(normalizedUrl).slice(0,24)}`, normalizedUrl };
  }
  throw new Link2AIError('UNSUPPORTED_URL', 'This TikTok URL does not identify a supported video.');
}

export function assertSafeRedirect(urlString: string): void {
  let url: URL;
  try { url = new URL(urlString); } catch { throw new Link2AIError('INVALID_URL', 'Redirected URL is invalid.'); }
  if (url.protocol !== 'https:' || !allowedHosts.has(normalizeHost(url.hostname))) {
    throw new Link2AIError('UNSUPPORTED_URL', 'Redirect left the supported social-video domains.');
  }
}
