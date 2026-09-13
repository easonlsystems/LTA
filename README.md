# Link2AI

Link2AI is a remote MCP service that helps AI assistants read public social-video links when the assistant cannot reliably access the underlying spoken content itself.

Instead of replacing ChatGPT or Claude, Link2AI acts as a thin access layer:

```text
Public Instagram Reel / TikTok / YouTube URL
                    ↓
              URL validation
                    ↓
          Platform-specific resolver
                    ↓
       Captions first → ASR fallback
                    ↓
       Transcript + timestamps + metadata
                    ↓
          ChatGPT / Claude continues
```

## Why this project exists

A common failure mode in AI chat is simple: the user pastes a public social-video link and asks a question about the video, but the assistant cannot actually read the spoken content.

Link2AI focuses on that missing layer. It does not summarize, fact-check, translate, or run its own chatbot. Its job is to convert supported public video URLs into reliable AI-readable context and return that context to the assistant the user is already using.

## V1 scope

Supported:

- Instagram Reels
- TikTok
- YouTube
- YouTube Shorts
- Remote MCP clients such as ChatGPT and Claude

Intentionally out of scope for V1:

- Private or login-only media
- DRM or paid-content bypass
- Visual understanding / OCR
- A separate AI chat interface
- A transcript library
- Facebook / X ingestion

## Core engineering decisions

### Captions before ASR

When usable captions exist, Link2AI parses those instead of paying for speech-to-text. ASR is only used as a fallback.

### Resolver isolation

Instagram, TikTok, and YouTube are separated into platform resolvers so platform breakage can be contained instead of taking down the entire product.

### Canonical media cache

Cache identity is based on platform + canonical media ID + language rather than raw share URLs. This prevents duplicate work across different tracking/share links that point to the same media.

### Global in-flight deduplication

Concurrent requests for the same uncached media are coordinated so a viral video does not trigger duplicate transcription jobs.

### Security boundary

Public URLs are treated as untrusted input. The service validates supported hosts, re-checks redirects, blocks private/link-local address ranges, limits remote metadata responses, isolates OAuth resources, and treats transcript text as untrusted data rather than instructions.

### Privacy and retention

Temporary media/audio are deleted after processing. Transcript cache entries expire and are deleted after the configured retention period. Historical jobs scrub media identifiers after the retention window.

## Architecture

```text
ChatGPT / Claude
       ↓
Remote MCP + OAuth
       ↓
API service
├── account/auth
├── quota/entitlements
├── billing hooks
├── transcript jobs
└── public website/account routes
       ↓
PostgreSQL
       ↕
Worker
├── platform resolvers
├── caption extraction
├── FFmpeg normalization
└── speech-to-text fallback
```

More detail is available in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/SECURITY.md`](docs/SECURITY.md).

## MCP tools

The V1 interface intentionally stays small:

- `get_video_transcript(url)`
- `get_transcript_result(job_id)`
- `get_usage()`

The assistant decides when it actually needs Link2AI. A supported URL appearing in conversation does not automatically mean the tool should be called.

## Validation status

The current V1 source has passed clean dependency installation, production TypeScript build, the complete automated test suite, MCP initialization/tool-discovery checks, runtime API/website smoke tests, and a production dependency vulnerability audit.

Current phase: **runtime / staging acceptance**.

Still requiring real-environment acceptance before production launch:

- PostgreSQL migrations and concurrency behavior on a real database
- Docker/Railway runtime
- live transcription providers
- real public Instagram/TikTok/YouTube media
- email delivery
- billing webhooks and subscription lifecycle
- live ChatGPT / Claude connection flows

This distinction is intentional: source correctness is not treated as proof of production readiness.

## Local development

Requirements:

- Node.js 22
- PostgreSQL
- FFmpeg
- yt-dlp

Install and test:

```bash
npm ci
npm run build
npm test
```

Copy `.env.example` to `.env` and provide the required local configuration before starting services.

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

The repository contains a Dockerfile and Railway configuration. The intended production topology is one API/MCP service, one Worker service, and PostgreSQL in the same Railway environment.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the deployment model.
