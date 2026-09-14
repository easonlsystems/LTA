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


## OpenAI plugin submission configuration

The API also supports the public Plugin review flow:

- `OPENAI_APPS_CHALLENGE` — exact token returned at `/.well-known/openai-apps-challenge` during domain verification.
- `REVIEWER_EMAIL` + `REVIEWER_PASSWORD` — optional dedicated review credentials. Configure both or neither. The reviewer path bypasses email OTP only for this exact account and grants a test-only Pro entitlement so the reviewer can complete the required test cases without a paid subscription.

Use a unique reviewer password of at least 16 characters. Never commit the credential to source control. Normal users continue to use passwordless email login.

The launch trial is 3 successful links or 10 minutes of processed content, whichever is reached first. A first-party device token provides a basic repeated-trial abuse check; it is a launch guardrail, not a claim of perfect person-level identity.

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


### Founding beta auth

- `PUBLIC_EMAIL_LOGIN_ENABLED=false` — default public beta mode. Users start a browser-bound free trial without email.
- `PUBLIC_EMAIL_LOGIN_ENABLED=true` — only enable after the production sender/domain can deliver OTP email to arbitrary users.
- `REVIEWER_EMAIL` + `REVIEWER_PASSWORD` — dedicated OpenAI review account; configure both together and do not commit credentials.
- `OPENAI_APPS_CHALLENGE` — set to the exact token shown by the OpenAI submission portal when domain verification becomes available.
