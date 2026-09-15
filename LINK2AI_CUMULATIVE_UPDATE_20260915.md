# Link2AI cumulative update — 2026-09-15

Baseline production commit: `e5069c6c7afa087c678c3fe230e196dfe262f626` (`Fix mobile UI across Link2AI`).

This package supersedes BOTH:
- `Link2AI_SUPPORT_EMAIL_FRONTEND_20260915.zip`
- `Link2AI_FOUNDER_ADMIN_DASHBOARD_20260915.zip`

Apply this package once. Do not apply either older package afterward.

## Included changes

### Support email visibility
- Main site footer shows the current `SUPPORT_EMAIL`.
- `/support` shows the support email below the CTA.
- Login/signup/auth screens show the support email.
- Account/pricing/billing screens show the support email.
- No address is hard-coded; existing Railway `SUPPORT_EMAIL` is used.

### Private Founder Admin
- `/founder` global account/usage dashboard.
- Full account email, plan/status, trial eligibility, Claude connection, successful links, minutes, failures, last activity.
- Email search and 100-account pagination.
- `/founder/user/:id` account management.
- Manual Trial/Basic/Pro, account status, trial eligibility, bonus minutes and bonus links.
- Founder adjustment audit log.
- Existing usage history is preserved.
- The founder account cannot disable itself from the founder UI.
- Lemon Squeezy subscription webhooks can later replace manual plan state.

## Database additions
- `users.admin_bonus_seconds`
- `users.admin_bonus_videos`
- `founder_admin_events`

The normal Railway pre-deploy command `npm run db:migrate:prod` applies the idempotent migration.

## Railway variable required
Set `FOUNDER_EMAIL` on the API service to the exact email of the Link2AI account that should be allowed to open `/founder`.

`SUPPORT_EMAIL` already exists in production and is reused by the frontend support-email changes.

## Merge validation
- Founder `src/api/main.ts` preserved in full, with only the two intended support-email frontend changes merged into it.
- `src/auth/routes.ts` and `src/billing/routes.ts` come from the support-email patch.
- `.env.example`, migration, env config and quota service come from the Founder Admin patch.
- No merge-conflict markers remain.
