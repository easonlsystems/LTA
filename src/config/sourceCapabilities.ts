import { env } from './env.js';

export interface SourceCapabilities {
  reddit: boolean;
}

export function sourceCapabilities(): SourceCapabilities {
  const e=env();
  return {
    // Reddit's hosted-service Data API requires approved OAuth credentials. Treat the
    // source as unavailable everywhere until both credentials are configured.
    reddit: Boolean(e.REDDIT_CLIENT_ID?.trim() && e.REDDIT_CLIENT_SECRET?.trim())
  };
}

export function supportedSourceDescription(capabilities=sourceCapabilities()): string {
  return `${capabilities.reddit?'Reddit, ':''}YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issue/PR, Hacker News, readable webpage/article, or text-layer PDF`;
}
