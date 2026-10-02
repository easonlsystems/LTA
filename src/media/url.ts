import { Link2AIError } from '../util/errors.js';
import { sha256 } from '../util/crypto.js';

export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'x' | 'reddit' | 'bluesky' | 'github' | 'hackernews' | 'pdf' | 'web' | 'upload';
export type LinkKind = 'media' | 'post' | 'page' | 'document';

const socialHosts = new Set([
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com',
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'redd.it',
  'bsky.app', 'github.com', 'news.ycombinator.com'
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
  url.hash='';
  for(const key of [...url.searchParams.keys()]){
    if(trackingParams.has(key.toLowerCase()))url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url;
}

export function parseMediaUrl(raw: string): ParsedMediaUrl {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new Link2AIError('INVALID_URL', 'The provided value is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new Link2AIError('INVALID_URL', 'Only HTTPS URLs are accepted.');
  if(url.username||url.password)throw new Link2AIError('INVALID_URL','URLs containing embedded credentials are not accepted.');
  if(raw.length>4096)throw new Link2AIError('INVALID_URL','This URL is too long.');
  cleanUrl(url);
  const host = normalizeHost(url.hostname);

  const isDomain=(base:string)=>host===base||host.endsWith(`.${base}`);
  if (isDomain('youtube.com') || host === 'youtu.be') return parseYouTube(url);
  if (isDomain('instagram.com')) return parseInstagram(url);
  if (isDomain('tiktok.com')) return parseTikTok(url);
  if (isDomain('x.com')||isDomain('twitter.com')) return parseX(url);
  if (isDomain('reddit.com')||host==='redd.it') return parseReddit(url);
  if (host==='bsky.app') return parseBluesky(url);
  if (host==='github.com'||host==='www.github.com') return parseGitHub(url);
  if (host==='news.ycombinator.com') return parseHackerNews(url);

  if(/\.pdf$/i.test(url.pathname)){
    const normalizedUrl=url.toString();
    return {platform:'pdf',kind:'document',sourceUrl:normalizedUrl,normalizedUrl,canonicalMediaId:`pdf_${sha256(normalizedUrl).slice(0,40)}`};
  }

  // Generic public webpages are supported as text pages. Network safety (DNS/IP,
  // redirect-by-redirect validation and response limits) is enforced by safeHttp.
  const normalizedUrl=url.toString();
  return {
    platform:'web', kind:'page', sourceUrl:normalizedUrl, normalizedUrl,
    canonicalMediaId:`web_${sha256(normalizedUrl).slice(0,40)}`
  };
}

function parseBluesky(url:URL):ParsedMediaUrl{
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts.length!==4||parts[0]!=='profile'||parts[2]!=='post'||!/^[A-Za-z0-9._:%-]{1,253}$/.test(parts[1]??'')||!/^[A-Za-z0-9]{5,64}$/.test(parts[3]??'')){
    throw new Link2AIError('UNSUPPORTED_URL','Link2AI supports individual public Bluesky posts, not profiles, feeds or timelines.');
  }
  const actor=decodeURIComponent(parts[1]).toLowerCase();
  const rkey=parts[3];
  const normalizedUrl=`https://bsky.app/profile/${encodeURIComponent(actor)}/post/${rkey}`;
  return {platform:'bluesky',kind:'post',sourceUrl:normalizedUrl,normalizedUrl,canonicalMediaId:`${actor}/${rkey}`};
}

function parseGitHub(url:URL):ParsedMediaUrl{
  const parts=url.pathname.split('/').filter(Boolean);
  const owner=parts[0]??'',repo=parts[1]??'',type=parts[2]??'',number=parts[3]??'';
  if(parts.length!==4||!owner||!repo||!['issues','pull'].includes(type)||!/^\d{1,12}$/.test(number)){
    throw new Link2AIError('UNSUPPORTED_URL','Link2AI supports individual public GitHub issues and pull requests.');
  }
  const normalizedUrl=`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${type}/${number}`;
  return {platform:'github',kind:'post',sourceUrl:normalizedUrl,normalizedUrl,canonicalMediaId:`${owner.toLowerCase()}/${repo.toLowerCase()}/${type}/${number}`};
}

function parseHackerNews(url:URL):ParsedMediaUrl{
  if(url.pathname!=='/item'||!/^[1-9]\d{0,11}$/.test(url.searchParams.get('id')??'')){
    throw new Link2AIError('UNSUPPORTED_URL','Link2AI supports individual Hacker News story/item discussions, not feeds or homepages.');
  }
  const id=url.searchParams.get('id')!;
  const normalizedUrl=`https://news.ycombinator.com/item?id=${id}`;
  return {platform:'hackernews',kind:'post',sourceUrl:normalizedUrl,normalizedUrl,canonicalMediaId:id};
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

  // Reddit's mobile share action can produce opaque links such as
  // /r/<subreddit>/s/<share_token>. The token is not a post id, so keep the
  // share URL as a temporary canonical key and let the worker resolve the
  // redirect before cache lookup or quota finalization.
  const subredditShare=host!=='redd.it'&&parts[0]==='r'&&parts[2]==='s'&&parts.length===4;
  const directShare=host!=='redd.it'&&parts[0]==='s'&&parts.length===2;
  if(subredditShare||directShare){
    const subreddit=subredditShare?(parts[1]??''):'';
    const shareToken=subredditShare?(parts[3]??''):(parts[1]??'');
    if((subredditShare&&!/^[A-Za-z0-9_]{2,64}$/.test(subreddit))||!/^[A-Za-z0-9_-]{5,128}$/.test(shareToken)){
      throw new Link2AIError('INVALID_URL','Invalid Reddit share URL.');
    }
    const normalizedUrl=subredditShare
      ?`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/s/${encodeURIComponent(shareToken)}/`
      :`https://www.reddit.com/s/${encodeURIComponent(shareToken)}/`;
    return {
      platform:'reddit',kind:'post',sourceUrl:normalizedUrl,normalizedUrl,
      canonicalMediaId:`share_${sha256(normalizedUrl).slice(0,24)}`
    };
  }

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
