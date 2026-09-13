# Deployment notes

The intended production topology is one Railway project with three components:

1. PostgreSQL
2. API service
3. Worker service

The API and Worker build from the same repository and image.

## API

```text
start: node dist/src/api/main.js
pre-deploy: node dist/scripts/migrate.js
health check: /healthz
```

## Worker

```text
start: node dist/src/worker/main.js
health check: /healthz
```

## Health model

`/healthz` is process liveness and deliberately does not depend on PostgreSQL.

`/readyz` checks database connectivity and launch-critical configuration. A process may be healthy while the product is not ready to serve production traffic.

## Required external systems

- PostgreSQL
- Groq and/or OpenAI-compatible transcription provider
- Resend for production passwordless login
- Lemon Squeezy for subscription billing
- yt-dlp and FFmpeg (installed by the Docker image)

Environment variable names are documented in `.env.example`. Secrets should be provided through the hosting platform and never committed to the repository.

## Runtime acceptance

Before public launch, staging should verify at minimum:

- YouTube caption path
- YouTube / social-video ASR path
- one public TikTok
- one public Instagram Reel
- private/removed media fails without consuming quota
- repeated same-user request does not double charge
- second-user cache hit still follows their own quota rules
- OAuth connection from the target AI clients
- email OTP delivery
- subscription checkout and webhook lifecycle
- Worker restart / SIGTERM behavior
