# Link2AI

> **Claude-first founding beta:** V1 distribution and onboarding are focused on Claude first to validate demand and usability with real users. ChatGPT remains a first-class product target and is the next distribution surface.

Link2AI is a remote MCP service that helps AI assistants read supported public links when the assistant cannot reliably access the content behind them.

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

A common failure mode in AI chat is simple: the user pastes a supported public link and asks a question about it, but the assistant cannot actually access the content behind that link.

Link2AI focuses on that missing layer. It does not summarize, fact-check, translate, or run its own chatbot. Its job is to turn supported public links into reliable AI-readable context and return that context to the assistant the user is already using.

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

The baseline in this repository has already been deployed to the production Railway topology. The 2026-09-14 launch hotfix changes onboarding, review access, OpenAI submission support, and trial policy, so it must be redeployed and smoke-tested again before public directory submission.

For this hotfix, the dependency-light TypeScript structural check and pure regression suite pass locally. A clean `npm ci` / full package build could not be rerun in the packaging sandbox because that environment could not resolve `registry.npmjs.org`; production CI/Railway remains the final networked build gate.

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


## Founding beta sign-in

Public users now use a Link2AI **email + password account**. The email is the stable account identity for trial usage, paid plan state, web sessions and Claude OAuth authorization. Passwords are never stored in plaintext: Link2AI uses a per-account random salt and Node's scrypt password derivation before storage. The first-party `link2ai_trial_device` cookie remains only as an anti-abuse/returning-device signal; it is no longer the user's identity. Existing anonymous beta accounts can be upgraded in place so their usage and OAuth records stay attached.

`PUBLIC_EMAIL_LOGIN_ENABLED` now controls only the optional legacy email-OTP path. The normal public password login does not require Resend or a verified outbound-email domain. OpenAI reviewers continue to use the dedicated reviewer credential path configured only through Railway environment variables.

### Claude-first onboarding

Public beta onboarding is documented at `/connect`. The preferred flow is Claude custom connector → **Sign in now** → **Register automatically (DCR)** → Add → create/sign in to the Link2AI email account → approve the Link2AI OAuth connection. Users should not need a manually issued OAuth client ID or secret. The `/connect` tab stays open while Claude setup runs in a new tab and changes into `/account` after a fresh OAuth connection is detected.

V1 returns spoken/caption text. Visual-only information may be missing; tool responses carry an explicit limitation notice so hosts should not infer unsupported visual structure.
