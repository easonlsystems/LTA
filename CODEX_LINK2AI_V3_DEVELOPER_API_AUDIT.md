# Link2AI V3 developer API completion audit

Date: 2026-09-20  
Base revision audited: `2c9a2c075027001d793c8b505ee4378134f3f448`

## Contract decisions

- `id` is the canonical public job identifier. `job_id` is emitted with the same value as a backward-compatible alias.
- Every REST error now emits both `error_code` and the legacy `error` alias with the same value. Existing clients reading `error` continue to work.
- `POST /v1/read` and `GET /v1/jobs/{id}` continue to call `src/source/service.ts`; no REST-only extractor, cache, quota, or source policy was introduced.
- A completed result retains canonical URL, source identity, content/transcript, metadata, evidence, completeness, truncation, and usage fields.
- Failed and non-terminal results report zero `units_used`. Shared source accounting remains authoritative for retries and cached reads.

## Onboarding path

The intended path is now explicit and linked end to end:

1. Homepage → Developers.
2. Developers → Account → create API key.
3. One-time key page → anchored quickstart.
4. Quickstart → read request → poll by `id` when 202.
5. Account → usage, recent job status, units, error, and job detail.
6. Account → revoke key.

The developer guide documents bearer authentication, synchronous and asynchronous reads, terminal states, 401/402/422 handling, retryability, canonical identity, metadata/evidence, completeness/truncation, usage, cache/retry behavior, refresh semantics, discovery endpoints, and complete curl/JavaScript/Python examples.

## Production certification infrastructure

`test/production-authenticated-cert.mjs` exercises a real deployed lifecycle through the production reviewer authentication path:

- sign in through `/auth/reviewer` without printing credentials;
- send same-origin browser-form POSTs with the production origin so CSRF/origin protections remain exercised rather than bypassed;
- create a one-time API key;
- call usage and sources;
- submit a controlled supported source and poll to completion;
- verify useful content, canonical URL, completeness, and usage fields;
- confirm the job appears in the account dashboard;
- revoke the created key; and
- verify the revoked key receives 401.

The reviewer path is intentionally used because production normally has Google sign-in enabled, which disables `/auth/password/login`. This keeps certification compatible with the real deployed authentication configuration.

The manual GitHub Actions workflow reads credentials only from repository secrets and the script revokes its created key in a `finally` cleanup. Production authenticated certification is blocked until these GitHub Actions secrets exist:

- `LINK2AI_PRODUCTION_URL`
- `LINK2AI_CERT_EMAIL` — copy of the production reviewer email credential
- `LINK2AI_CERT_PASSWORD` — copy of the production reviewer password credential

`LINK2AI_CERT_SOURCE_URL` is optional and defaults to the stable Hacker News thread `https://news.ycombinator.com/item?id=8863`.

Do not commit or print any of these credentials.

## Homepage acceptance

The interactive comparison now renders a meaningful representative before/after state on first paint. Interaction still resets, runs, and changes sources responsively; it no longer resembles an unloaded shell before the first click.

## Verification

- TypeScript production build.
- Complete repository test suite, including security and log-privacy tests.
- Added developer-onboarding, compatibility-alias, authenticated-lifecycle, and initial-demo regressions.
- Public production certification remains unauthenticated and secret-free; authenticated production certification is separate and explicitly credential-gated.
- Independent follow-up review fixed two production-only issues in the original authenticated certification implementation: password login is unavailable when Google sign-in is configured, and browser-form POSTs require a valid same-origin signal.
