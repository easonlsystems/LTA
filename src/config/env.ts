import { z } from 'zod';
import { normalizePublicBaseUrl } from './publicUrl.js';

const boolish = z.string().optional().transform((v:string|undefined) => ['1','true','yes','on'].includes((v ?? '').toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BRAND_NAME: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/).default('LTA'),
  PUBLIC_BASE_URL: z.string().url().transform((v:string,ctx:any)=>{
    try{return normalizePublicBaseUrl(v);}
    catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'Invalid PUBLIC_BASE_URL'});return z.NEVER;}
  }),
  APP_SECRET: z.string().min(32),
  YTDLP_BIN: z.string().default('yt-dlp'),
  FFMPEG_BIN: z.string().default('ffmpeg'),
  MEDIA_PROVIDER_URL: z.string().url().optional().or(z.literal('')),
  MEDIA_PROVIDER_API_KEY: z.string().optional(),
  MAX_DOWNLOAD_BYTES: z.coerce.number().int().positive().default(262_144_000),
  EXTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  AUDIO_EXTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  GROQ_API_KEY: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().trim().min(1).optional(),
  REDDIT_CLIENT_SECRET: z.string().trim().min(1).optional(),
  REDDIT_USER_AGENT: z.string().trim().min(8).max(256).default('LTA/1.3 public-link-reader'),
  GROQ_TRANSCRIPTION_MODEL: z.string().default('whisper-large-v3-turbo'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
  RESEND_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
  PUBLIC_EMAIL_LOGIN_ENABLED: boolish,
  AUTH_FROM_EMAIL: z.string().default('LTA <login@example.com>'),
  SUPPORT_EMAIL: z.string().email().optional(),
  FOUNDER_EMAIL: z.string().email().optional(),
  AUTH_EMAIL_GLOBAL_LIMIT_15M: z.coerce.number().int().min(10).max(10000).default(200),
  OAUTH_DCR_GLOBAL_LIMIT_HOUR: z.coerce.number().int().min(10).max(100000).default(2000),
  DEV_SHOW_LOGIN_CODE: boolish,
  OPENAI_APPS_CHALLENGE: z.string().trim().min(1).max(512).optional(),
  REVIEWER_EMAIL: z.string().email().optional(),
  REVIEWER_PASSWORD: z.string().min(16).max(256).optional(),
  LEMONSQUEEZY_API_KEY: z.string().optional(),
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().optional(),
  LEMONSQUEEZY_STORE_ID: z.string().optional(),
  LEMONSQUEEZY_BASIC_VARIANT_ID: z.string().optional(),
  LEMONSQUEEZY_PRO_VARIANT_ID: z.string().optional(),
  LEMONSQUEEZY_TOPUP_500_VARIANT_ID: z.string().optional(),
  LEMONSQUEEZY_TOPUP_1500_VARIANT_ID: z.string().optional(),
  LEMONSQUEEZY_TEST_MODE: boolish,
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  MCP_INLINE_WAIT_MS: z.coerce.number().int().nonnegative().default(25_000),
  TRANSCRIPT_CACHE_HOURS: z.coerce.number().int().positive().default(72)
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
