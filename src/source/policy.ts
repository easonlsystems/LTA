import { parseMediaUrl, type ParsedMediaUrl, type Platform } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';

export type DistributionProfile='default'|'openai';

const OPENAI_ALLOWED_PLATFORMS=new Set<Platform>(['github']);

export function platformAllowedForProfile(platform:Platform,profile:DistributionProfile):boolean{
  return profile!=='openai'||OPENAI_ALLOWED_PLATFORMS.has(platform);
}

export function assertPlatformAllowedForProfile(platform:Platform,profile:DistributionProfile):void{
  if(platformAllowedForProfile(platform,profile))return;
  throw new Link2AIError(
    'PLATFORM_BLOCKED',
    'This source is not available through the ChatGPT distribution of LTA.',
    422,
    false,
    {cause_code:'openai_source_not_authorized'}
  );
}

export function parseAllowedMediaUrl(raw:string,profile:DistributionProfile):ParsedMediaUrl{
  const parsed=parseMediaUrl(raw);
  assertPlatformAllowedForProfile(parsed.platform,profile);
  return parsed;
}

export function supportedSourcesForProfile(profile:DistributionProfile,redditReady=false):string{
  if(profile==='openai')return 'GitHub Issue/PR from repositories with a ChatGPT-eligible CC0-1.0, 0BSD, or Unlicense content license';
  return `${redditReady?'Reddit, ':''}YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issue/PR, Hacker News, readable webpage/article, or text-layer PDF`;
}
