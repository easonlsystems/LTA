# Link2AI Email Account Launch Final — 2026-09-15

This cumulative launch patch replaces browser-cookie identity with a real Link2AI email account while preserving the Claude-first onboarding work and the setup-to-dashboard handoff.

## Public account model

- New users create or sign in with **email + password** during the Claude OAuth flow.
- The normalized email is the stable Link2AI account identity for trial usage, paid plan state, web sessions and Claude OAuth authorization.
- Passwords are never stored in plaintext. Link2AI stores a per-account random salt and a Node `scrypt` derived hash.
- Web sessions remain HTTP-only, SameSite cookies with a 30-day lifetime.
- The first-party `link2ai_trial_device` cookie remains only for trial anti-abuse / returning-device checks. It is no longer the account identity.
- Repeated failed password attempts are rate limited using a privacy-preserving HMAC of the email.

## Existing beta users

- Existing anonymous trial accounts can be upgraded **in place** to an email account.
- The existing `user_id` is retained, so usage ledger rows, quota state, OAuth tokens and trial-device claims stay attached.
- New anonymous guest accounts are no longer created. The old guest path only restores a previously claimed legacy browser token.
- A legacy anonymous account is forced through `/signup` before it can authorize a new Claude OAuth connection or start paid checkout.

## Billing and dashboard

- `/account` now shows the signed-in email, plan, used minutes, remaining trial links, billing controls and Sign out.
- Paid checkout requires an email-backed Link2AI account.
- Lemon Squeezy checkout continues to receive the Link2AI `user_id` and now consistently receives the account email when available.
- The `/connect` page stays open while Claude setup happens in a new tab and switches to `/account` after a fresh OAuth connection is detected.

## Email infrastructure

Normal public sign-in **does not require Resend or a verified outbound-email domain**. `PUBLIC_EMAIL_LOGIN_ENABLED=false` can remain unchanged; that variable now controls only the optional legacy email-code/OTP path.

For the founding beta, password reset is not yet self-service. A user who loses the password must use Support. This avoids adding another email-provider/domain dependency before launch.

## Database migration

Additive migration only:

- `users.password_hash`
- `users.password_salt`
- `users.password_set_at`
- `password_auth_attempts`

No existing account, transcript, usage, subscription or OAuth tables are replaced.

## Validation completed in the build workspace

- `tsc -p tsconfig.check.json --pretty false` — PASS
- `tsc -p tsconfig.pure.json --pretty false` — PASS
- `node test/pure.mjs` — PASS, including scrypt hash/verify tests
- `node --check test/runtime-smoke.mjs` — PASS
- `node --check test/pure.mjs` — PASS

A full local `npm test` could not be run because the workspace does not contain a complete install of the runtime dependencies. Railway's normal Docker build remains the authoritative full compile/deploy gate.

## No new production secret required

This patch does not require a new domain, new paid service, new Railway service, or a Railway Agent. Existing environment values can remain as-is.
