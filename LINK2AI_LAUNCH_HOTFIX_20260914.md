# Link2AI launch hotfix — 2026-09-14

## Baseline
User-provided current GitHub `main` archive: `link2ai-main.zip`.

This package is cumulative from that exact baseline.

## Why this hotfix exists
Founder dogfood exposed launch-blocking onboarding and free-trial issues:
- standalone sign-in looked like a dead end;
- public setup copy was technical and video-first instead of link-first;
- the free trial was too generous for an email-only signup model;
- OpenAI public submission needs a domain challenge, review credentials that do not depend on OTP/email confirmation, and accurate MCP tool annotations.

## Changes

### Product / onboarding
- Reworked public website copy around **“Paste a link. Your AI can read it.”**
- Replaced the old README-like Connect page with a clearer Claude/ChatGPT setup page.
- Added visual step cards for Claude custom-connector setup.
- Normal OAuth login still returns to the OAuth authorization flow and then the host AI callback.
- Rebuilt login/OTP pages into a focused two-step connection UI.
- User-facing usage/error copy is link/content-first rather than repeatedly calling the product a video tool.

### Trial policy
- Trial changed to **3 successful links OR 10 minutes of processed content**, whichever is reached first.
- Existing quota reservations already serialize through the user row, so simultaneous processing cannot independently overshoot the same user's available quota.
- Added a first-party trial-device claim:
  - the first trial account claims the random device token;
  - another trial account presenting the same token is marked ineligible for a fresh trial;
  - the claim is serialized to avoid concurrent double-claim races.
- This is a first-launch abuse guardrail, not perfect person-level identity. Clearing cookies/incognito/new devices can still evade device-only detection; stronger risk controls can be added after launch data exists.

### OpenAI submission support
- Added `GET /.well-known/openai-apps-challenge`.
- Added `OPENAI_APPS_CHALLENGE`.
- Added exact-account reviewer credentials:
  - `REVIEWER_EMAIL`
  - `REVIEWER_PASSWORD`
- Reviewer login bypasses email OTP only for the configured reviewer credential and gives that dedicated account a test-only Pro entitlement so OpenAI review is not blocked by the public trial cap.
- Added/updated MCP annotations:
  - `get_video_transcript`: non-read-only, non-destructive, non-idempotent, open-world.
  - result/usage tools: read-only, non-destructive, idempotent, closed-world.
- Added `docs/OPENAI_SUBMISSION_20260914.md`.

### Database
Migration is additive/idempotent:
- `users.trial_eligible`
- `trial_device_claims`

## Files changed
- `.env.example`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/OPENAI_SUBMISSION_20260914.md` (new)
- `sql/001_init.sql`
- `src/api/main.ts`
- `src/auth/routes.ts`
- `src/auth/service.ts`
- `src/billing/routes.ts`
- `src/config/env.ts`
- `src/config/readiness.ts`
- `src/mcp/server.ts`
- `src/mcp/service.ts`
- `src/quota/plans.ts`
- `src/quota/service.ts`
- `src/util/errors.ts`
- `src/worker/jobs.ts`
- `test/mcp-smoke.mjs`
- `test/pure.mjs`
- `test/runtime-smoke.mjs`

## Validation in packaging environment
Passed:
- `tsc -p tsconfig.check.json --pretty false`
- `tsc -p tsconfig.pure.json --pretty false`
- `node test/pure.mjs`

Not rerun here:
- clean `npm ci`
- full `npm run build`
- package-dependent MCP/runtime smoke suite

Reason: the packaging sandbox could not resolve `registry.npmjs.org` (`EAI_AGAIN`) and the uploaded ZIP intentionally did not contain `node_modules`.

This is an environment/network limitation, not a claim that the full networked build passed. The GitHub/Railway deployment is the required final build/runtime gate after this package is pushed.

## Required production environment additions
Before OpenAI review:
- `REVIEWER_EMAIL=<dedicated reviewer login>`
- `REVIEWER_PASSWORD=<unique 16+ char secret>`
- `OPENAI_APPS_CHALLENGE=<token from OpenAI portal>` (set when the portal provides it)

Do not put these secrets into source control.

## Deployment sequence
1. Push this cumulative source over current GitHub `main`.
2. Let Railway auto-deploy API + Worker and run the database migration.
3. Verify deployment/build success and `/healthz`.
4. Verify `/readyz`.
5. Configure reviewer credentials and test reviewer OAuth without OTP.
6. Enter OpenAI submission portal.
7. When OpenAI provides the challenge token, set `OPENAI_APPS_CHALLENGE`, redeploy, and verify exact plain-text challenge response.
8. Run tool scan/test cases and submit for review.

Do not switch Lemon Squeezy to Live until founder dogfood and account-bound checkout are verified.
