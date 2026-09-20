import { parseMediaUrl, type ParsedMediaUrl, type Platform } from '../media/url.js';

export type DistributionProfile='default'|'openai';

export function platformAllowedForProfile(_platform:Platform,_profile:DistributionProfile):boolean{
  return true;
}

export function assertPlatformAllowedForProfile(_platform:Platform,_profile:DistributionProfile):void{
  // OpenAI and default/Claude distributions intentionally share the same
  // source matrix. Distribution-specific differences belong to OAuth,
  // tool surface, and UX—not source availability.
}

export function parseAllowedMediaUrl(raw:string,profile:DistributionProfile):ParsedMediaUrl{
  const parsed=parseMediaUrl(raw);
  assertPlatformAllowedForProfile(parsed.platform,profile);
  return parsed;
}

export function supportedSourcesForProfile(_profile:DistributionProfile,redditReady=false):string{
  return `${redditReady?'Reddit, ':''}YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issue/PR, Hacker News, readable webpage/article, or text-layer PDF`;
}
