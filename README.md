# LTA

> **Public URL in. AI-ready source context out.**

LTA is source infrastructure that turns supported public links into AI-readable source context. Claude, Grok, compatible MCP clients, and the public REST API all use the same source engine, jobs, cache, quota, completeness, and provenance model.

LTA does not summarize, translate, fact-check or run its own chatbot. The host AI still does the reasoning and produces the answer.

```text
Public link
    ↓
URL validation + content classification
    ↓
video ───────→ captions first → ASR fallback
post/page ───→ public text extraction
    ↓
metadata + AI-readable source text
    ↓
AI client / agent / workflow continues
```

## Supported beta sources

- YouTube and YouTube Shorts videos
- TikTok videos
- Instagram Reels
- Public Instagram posts
- Individual public X posts
- Individual public Reddit posts + a bounded set of public comments, only when Reddit OAuth credentials are configured
- Individual public Bluesky posts with bounded directly-attached context
- Public GitHub issues and pull requests with bounded discussion/reviews
- Individual Hacker News items with a bounded comment tree
- Direct public text-layer PDFs (no OCR, scripts, attachments, or embedded fetches)
- Readable public HTTPS webpages and articles

TikTok photo posts are accepted by the URL layer and use the post extractor when the public page exposes usable text.

Not supported:

- Private or login-only content
- Profiles, feeds, timelines or bulk crawling
- Paywall, DRM or access-control bypass
- Full visual understanding / OCR
- A separate LTA chat UI
- A permanent content library

## Core engineering decisions

### One link-reading interface

The MCP tool id remains `get_video_transcript` for backward compatibility with already-connected clients, but its product-facing title is **Read link content** and it can return video transcripts, post text or webpage text. New responses include `content_type` and `content_text` while preserving the legacy `transcript` field.

### Media pipeline

For supported videos, LTA prefers usable publisher/platform captions. Only when captions are unavailable does it download temporary media, normalize audio and use speech-to-text.

### Text-link pipeline

For supported posts and webpages, LTA extracts public text directly rather than forcing the media pipeline:

- X posts use public embed metadata.
- Reddit posts use Reddit's OAuth Data API and are advertised at runtime only when both Reddit OAuth credentials are configured. There is no anonymous scraping fallback.
- Instagram/TikTok posts first use the dedicated social extractor and fall back to the public page when possible.
- Generic webpages use the SSRF-safe HTTP client, accept only HTML/text responses, remove common non-content regions and return bounded readable text.

### Canonical cache + in-flight deduplication

Cache identity is based on platform + canonical source ID + language instead of raw tracking/share URLs. Concurrent requests for the same uncached content share the existing media-claim mechanism so the worker does not perform duplicate extraction.

### Quota behavior

Processing units are the product-level source-size budget. Video reads use one unit per started processed minute. Text reads use about one unit per 2,500 estimated source tokens, with a minimum of one unit for a successful read. Failed and unsupported reads use 0 units.

If a complete supported source requires more units than the account has available, LTA returns a payment-required state instead of intentionally publishing a size-truncated success. When known, the result includes both `remaining_usage_units` and `required_usage_units`.

### Security boundary

Public URLs are untrusted input. Generic webpage fetching uses HTTPS only, validates DNS/IPs before requests and after redirects, rejects private/link-local destinations, limits response size and content type, and treats extracted text as untrusted external content rather than instructions.

### Privacy and retention

Temporary media/audio are deleted after processing. Cached source text/transcripts expire after the configured retention period. Historical jobs scrub source identifiers after retention. LTA does not intentionally build a permanent corpus of scraped pages or media.

## Architecture

```text
Claude / Grok / compatible MCP clients     REST API clients
                 ↓                              ↓
          Remote MCP + OAuth               /v1/read + jobs
                 └──────────────┬───────────────┘
                                ↓
                      Shared Source Engine
                  ├── source policy / identity
                  ├── jobs + cache + provenance
                  ├── quota / entitlements
                  └── completeness / error model
                                ↓
                           PostgreSQL
                                ↕
                             Worker
                  ├── URL classifier
                  ├── social/page text extractor
                  ├── platform media resolvers
                  ├── caption extraction
                  ├── FFmpeg normalization
                  └── speech-to-text fallback
```

## MCP tools

The default LTA MCP surface exposes:

- `read_public_link` — read one supported public URL.
- `read_public_links` — read multiple supported public URLs while preserving source identity.
- `get_transcript_result` — poll jobs and continue long results.
- `get_video_time_range` — read timestamped text from an existing processed video.
- `find_in_link` — lexical search inside an existing processed source.
- `get_video_map` — compact timeline map for an existing processed video.
- `get_usage` — authoritative processing-unit and concurrency usage.
- `get_video_transcript` — legacy compatibility alias for already-connected clients.

Tool descriptions state capabilities and source scope without trying to control the host AI's unrelated tool choices.

## Public REST API beta

Developer clients can use the same source engine through:

- `POST /v1/read`
- `GET /v1/jobs/{job_id}`
- `GET /v1/usage`
- `GET /v1/sources`

API keys use the `l2ai_live_...` format. The full key is shown once; LTA stores only a hash plus a non-secret display prefix. Keys can be revoked from the account dashboard.

## Requirements

- Node.js 22+
- PostgreSQL
- FFmpeg
- yt-dlp
- gallery-dl
- At least one configured speech-to-text provider for media fallback

## Local development

```bash
npm ci
npm run build
npm test
```

Copy `.env.example` to `.env` and provide the required local configuration.

API:

```bash
npm run dev
```

Worker:

```bash
npm run dev:worker
```

Database migration:

```bash
npm run db:migrate
```

## Deployment

The production topology is one API/MCP service, one Worker service, and PostgreSQL in the same Railway environment. Both API and Worker use the same image/codebase with different start commands.

The current expansion keeps the existing job/cache tables and extends cache source types to `post` and `page`, so the migration must run before the new worker becomes active.

## Client onboarding

Claude onboarding lives at `/connect`. The preferred flow is Claude custom connector → LTA authorization → confirm LTA under Claude Connectors → paste the public URL in Claude.

Grok can use the production `/mcp` endpoint through Grok's documented Custom MCP connector flow; the integration package is under `integrations/grok/`. Public Grok Connector Catalog publication is a separate xAI approval step and is not claimed until approved.

Developer/API onboarding lives at `/developers`, with API key management and recent job diagnostics under `/account`.

The current production source model reads spoken/caption text from supported videos, public post text, discussions, readable public webpages, and text-layer PDFs. Reddit is advertised only when approved Reddit OAuth credentials are configured. Visual-only information can be missing when it is not represented in returned text.
