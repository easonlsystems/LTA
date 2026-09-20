# Link2AI

> **Public URL in. AI-ready source context out.**

Link2AI is source infrastructure that turns supported public links into AI-readable source context. Claude is the first end-user client, while the same read engine is also exposed through a public REST API for agents, workflows, research tools and SaaS products.

Link2AI does not summarize, translate, fact-check or run its own chatbot. The host AI still does the reasoning and produces the answer.

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
Claude / ChatGPT continues
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
- A separate Link2AI chat UI
- A permanent content library

## Core engineering decisions

### One link-reading interface

The MCP tool id remains `get_video_transcript` for backward compatibility with already-connected clients, but its product-facing title is **Read link content** and it can return video transcripts, post text or webpage text. New responses include `content_type` and `content_text` while preserving the legacy `transcript` field.

### Media pipeline

For supported videos, Link2AI prefers usable publisher/platform captions. Only when captions are unavailable does it download temporary media, normalize audio and use speech-to-text.

### Text-link pipeline

For supported posts and webpages, Link2AI extracts public text directly rather than forcing the media pipeline:

- X posts use public embed metadata.
- Reddit posts use Reddit's OAuth Data API and are advertised at runtime only when both Reddit OAuth credentials are configured. There is no anonymous scraping fallback.
- Instagram/TikTok posts first use the dedicated social extractor and fall back to the public page when possible.
- Generic webpages use the SSRF-safe HTTP client, accept only HTML/text responses, remove common non-content regions and return bounded readable text.

### Canonical cache + in-flight deduplication

Cache identity is based on platform + canonical source ID + language instead of raw tracking/share URLs. Concurrent requests for the same uncached content share the existing media-claim mechanism so the worker does not perform duplicate extraction.

### Quota behavior

Successful Trial reads consume one successful-link unit. Video processing also consumes measured content seconds. Text-only post/page jobs keep media duration at zero but consume **one equivalent content minute** from plan quota. This keeps the existing minute-based plans useful for both media and text links without pretending a webpage has a video duration. Failed jobs do not consume completed-job quota.

### Security boundary

Public URLs are untrusted input. Generic webpage fetching uses HTTPS only, validates DNS/IPs before requests and after redirects, rejects private/link-local destinations, limits response size and content type, and treats extracted text as untrusted external content rather than instructions.

### Privacy and retention

Temporary media/audio are deleted after processing. Cached source text/transcripts expire after the configured retention period. Historical jobs scrub source identifiers after retention. Link2AI does not intentionally build a permanent corpus of scraped pages or media.

## Architecture

```text
Claude / ChatGPT / compatible MCP client
                 ↓
          Remote MCP + OAuth
                 ↓
             API service
       ├── account/auth
       ├── quota/entitlements
       ├── billing hooks
       ├── link-reading jobs
       └── public website/account routes
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

The public interface intentionally stays small:

- `get_video_transcript(url)` — backward-compatible tool id; starts/reuses a **Read link content** job.
- `get_transcript_result(job_id)` — retrieve/poll a long-running result and page long source text.
- `get_usage()` — return the connected account's plan and quota.

A supported URL appearing in conversation does not automatically mean the tool should be called. The host AI should invoke it only when the user's request actually depends on the content behind the link and the AI does not already have sufficient access.

## Public API beta

Create an API key from the Link2AI account page. The full key is shown once and only a hash is stored.

```bash
curl https://api-production-0383e.up.railway.app/v1/read \
  -H "Authorization: Bearer l2ai_live_..." \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=..."}'
```

Public beta endpoints:

- `POST /v1/read` — submit one supported public URL.
- `GET /v1/jobs/{job_id}` — poll an asynchronous read.
- `GET /v1/usage` — authoritative processing-unit balance.
- `GET /v1/sources` — current supported source surface.

Connectors and API clients share the same jobs, cache, quota, provenance, billing and source engine.

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

## Claude-first onboarding

Public beta onboarding lives at `/connect`. The preferred flow is Claude custom connector → **Sign in now** → **Register automatically (DCR)** → Add → Link2AI account authorization. Users should not need a manually issued OAuth client ID or secret.

The beta can read spoken/caption text from supported videos, public post text, and readable public webpages. Reddit discussion context is available only when Reddit OAuth is configured. Visual-only information may still be missing unless it is present in readable page metadata/text.
