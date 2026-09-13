# Architecture

## Design goal

Link2AI is an access layer between an AI assistant and public social-video content that the assistant cannot reliably read on its own.

The service is intentionally not responsible for summarization or reasoning. Its job ends when it has returned normalized, AI-readable context.

## Request lifecycle

```text
URL
 ↓
URL validation + platform detection
 ↓
canonical media identity
 ↓
valid cache?
 ├─ yes → return cached transcript
 └─ no
      ↓
   resolver
      ↓
 usable captions?
 ├─ yes → parse / normalize
 └─ no
      ↓
   audio extraction
      ↓
   FFmpeg normalization
      ↓
   speech-to-text
      ↓
 transcript + segments
      ↓
 temporary cache
      ↓
 host AI
```

## Services

### API service

Responsible for:

- MCP endpoint
- OAuth / PKCE
- browser login session
- account and usage pages
- quota entrypoint
- billing routes / webhook
- liveness and readiness endpoints

### Worker service

Responsible for:

- claiming queued transcript jobs
- media resolver orchestration
- captions-first processing
- audio normalization and ASR
- transcript cache writes
- heartbeats and retry behavior
- temporary-file and stale-claim cleanup

### PostgreSQL

Stores:

- users and sessions
- OAuth clients / codes / tokens
- subscriptions
- transcript jobs
- usage ledger / quota reservations
- transcript cache
- global media claims

## Resolver strategy

Resolver code is isolated from the rest of the product because platform extraction reliability is the most volatile external dependency.

```text
platform resolver
  ↓
direct extraction
  ↓ fail
fallback extraction
  ↓ fail
optional external provider
```

Policy errors such as private media, removed media, or login-required content remain terminal and are not intentionally bypassed through third-party fallbacks.

## Cache and deduplication

Raw share URLs are normalized into canonical media identity. This provides two separate optimizations:

1. completed transcripts can be reused within the retention window;
2. in-flight global media claims prevent many workers from transcribing the same viral video simultaneously.

User quota remains separate from media processing cost. A cache hit avoids duplicate extraction/ASR but still belongs to the requesting user's entitlement model.

## Long-running jobs

`get_video_transcript` can return an asynchronous job ID when processing is not completed during the inline wait window.

`get_transcript_result` supports polling and character-window paging so long transcripts do not have to be returned in one MCP response.

## Failure model

Errors are classified into structured categories such as private media, login required, removed media, rate limiting, unsupported media, extraction failure, and internal failure.

Retryable infrastructure/platform errors can be retried by the Worker. Policy/validation failures are terminal. Internal error details stay in server logs and are not returned verbatim to MCP clients.
