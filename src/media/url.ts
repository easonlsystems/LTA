import { Link2AIError } from '../util/errors.js';
import { sha256 } from '../util/crypto.js';

export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'x' | 'reddit' | 'web';
export type LinkKind = 'media' | 'post' | 'page';

const socialHosts = new Set([
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com',
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'redd.it'
]);

const trackingParams = new Set([
  'si','igsh','utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id',
  'stkn','feature','share_app_id','share_item_id','fbclid','gclid','mc_cid','mc_eid','ref_src','ref_url'
]);

export interface ParsedMediaUrl {
  platform: Platform;
  kind: LinkKind;
  sourceUrl: string;
  normalizedUrl: string;
  canonicalMediaId: string;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function cleanUrl(url:URL):URL{
  url.username='';
  url.password='';
  url.hash='';
  for(const key of [...url.searchParams.keys()]){
    if(trackingParams.has(key.toLowerCase()))url.searchParams.delete(key);
  }
  return url;
}

export function parseMediaUrl(raw: string): ParsedMediaUrl {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new Link2AIError('INVALID_URL', 'The provided value is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new Link2AIError('INVALID_URL', 'Only HTTPS URLs are accepted.');
  if(raw.length>4096)throw new Link2AIError('INVALID_URL','This URL is too long.');
  cleanUrl(url);
  const host = normalizeHost(url.hostname);

  const isDomain=(base:string)=>host===base||host.endsWith(`.${base}`);
  if (isDomain('youtube.com') || host === 'youtu.be') return parseYouTube(url);
  if (isDomain('instagram.com')) return parseInstagram(url);
  if (isDomain('tiktok.com')) return parseTikTok(url);
  if (isDomain('x.com')||isDomain('twitter.com')) return parseX(url);
  if (isDomain('reddit.com')||host==='redd.it') return parseReddit(url);

  // Generic public webpages are supported as text pages. Network safety (DNS/IP,
  // redirect-by-redirect validation and response limits) is enforced by safeHttp.
  const normalizedUrl=url.toString();
  return {
    platform:'web', kind:'page', sourceUrl:normalizedUrl, normalizedUrl,
    canonicalMediaId:`web_${sha256(normalizedUrl).slice(0,40)}`
  };
}

function parseYouTube(url: URL): ParsedMediaUrl {
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
  return { platform:'youtube', kind:'media', sourceUrl:normalizedUrl, canonicalMediaId:id, normalizedUrl };
}

function parseInstagram(url: URL): ParsedMediaUrl {
  const parts = url.pathname.split('/').filter(Boolean);
  const type=parts[0]??'';
  const code=parts[1]??'';
  if (!['reel','reels','p'].includes(type) || !code) {
    throw new Link2AIError('UNSUPPORTED_URL', 'Link2AI currently supports individual public Instagram Reels and posts, not profiles or feeds.');
  }
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(code)) throw new Link2AIError('INVALID_URL', 'Invalid Instagram media code.');
  if(type==='p'){
    const normalizedUrl=`https://www.instagram.com/p/${encodeURIComponent(code)}/`;
    return { platform:'instagram', kind:'post', sourceUrl:normalizedUrl, canonicalMediaId:`post_${code}`, normalizedUrl };
  }
  const normalizedUrl=`https://www.instagram.com/reel/${encodeURIComponent(code)}/`;
  return { platform:'instagram', kind:'media', sourceUrl:normalizedUrl, canonicalMediaId:code, normalizedUrl };
}

function parseTikTok(url: URL): ParsedMediaUrl {
  const parts = url.pathname.split('/').filter(Boolean);
  const videoIdx = parts.indexOf('video');
  if (videoIdx >= 0 && parts[videoIdx + 1] && /^\d{8,30}$/.test(parts[videoIdx + 1])) {
    const id = parts[videoIdx + 1];
    const normalizedUrl=url.origin+url.pathname;
    return { platform:'tiktok', kind:'media', sourceUrl:normalizedUrl, canonicalMediaId:id, normalizedUrl };
  }
  const photoIdx=parts.indexOf('photo');
  if(photoIdx>=0&&parts[photoIdx+1]&&/^\d{8,30}$/.test(parts[photoIdx+1])){
    const id=parts[photoIdx+1];
    const normalizedUrl=`https://www.tiktok.com/${parts.slice(0,photoIdx+2).join('/')}`;
    return {platform:'tiktok',kind:'post',sourceUrl:normalizedUrl,canonicalMediaId:`photo_${id}`,normalizedUrl};
  }
  if (['vm.tiktok.com','vt.tiktok.com'].includes(url.hostname) || (['www.tiktok.com','m.tiktok.com','tiktok.com'].includes(url.hostname) && parts[0] === 't' && Boolean(parts[1]))) {
    const normalizedUrl=url.origin+url.pathname;
    return { platform:'tiktok', kind:'media', sourceUrl:normalizedUrl, canonicalMediaId:`short_${sha256(normalizedUrl).slice(0,24)}`, normalizedUrl };
  }
  throw new Link2AIError('UNSUPPORTED_URL', 'This TikTok URL does not identify a supported video or photo post.');
}

function parseX(url:URL):ParsedMediaUrl{
  const parts=url.pathname.split('/').filter(Boolean);
  const statusIdx=parts.indexOf('status');
  const id=statusIdx>=0?parts[statusIdx+1]??'':'';
  const user=statusIdx>0?parts[statusIdx-1]??'':'';
  if(!id||!/^\d{5,30}$/.test(id)||!user){
    throw new Link2AIError('UNSUPPORTED_URL','Link2AI currently supports individual public X posts, not profiles or timelines.');
  }
  const normalizedUrl=`https://x.com/${encodeURIComponent(user)}/status/${id}`;
  return {platform:'x',kind:'post',sourceUrl:normalizedUrl,normalizedUrl,canonicalMediaId:id};
}

function parseReddit(url:URL):ParsedMediaUrl{
  const host=normalizeHost(url.hostname);
  const parts=url.pathname.split('/').filter(Boolean);
  let id='';
  if(host==='redd.it'){
    id=parts[0]??'';
  }else{
    const commentsIdx=parts.indexOf('comments');
    if(commentsIdx>=0)id=parts[commentsIdx+1]??'';
    else if(parts[0]==='gallery')id=parts[1]??'';
  }
  if(!id||!/^[A-Za-z0-9]{3,16}$/.test(id)){
    throw new Link2AIError('UNSUPPORTED_URL','Link2AI currently supports individual public Reddit posts, not subreddit feeds, profiles or search pages.');
  }
  const canonical=id.toLowerCase();
  const normalizedUrl=`https://www.reddit.com/comments/${canonical}/`;
  return {platform:'reddit',kind:'post',sourceUrl:normalizedUrl,normalizedUrl,canonicalMediaId:canonical};
}

export function assertSafeRedirect(urlString: string): void {
  let url: URL;
  try { url = new URL(urlString); } catch { throw new Link2AIError('INVALID_URL', 'Redirected URL is invalid.'); }
  const host=normalizeHost(url.hostname);
  if (url.protocol!=='https:' || !socialHosts.has(host)) {
    throw new Link2AIError('UNSUPPORTED_URL', 'Redirect left the supported social domains.');
  }
}
