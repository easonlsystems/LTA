# Link2AI founder admin dashboard

Supersedes the earlier `Link2AI_FOUNDER_DASHBOARD_20260915` patch.

## Private founder access
Set `FOUNDER_EMAIL` to the email of the founder's Link2AI account.

- `/founder` requires a signed-in account matching `FOUNDER_EMAIL`.
- Other signed-in users receive 404.
- `/founder` is blocked in `robots.txt`.
- Founder POST changes require same-origin browser requests.

## Global dashboard
- Total accounts / 24h / 7d
- Claude-connected accounts
- Activated users
- Successful links / processed minutes
- Failed jobs
- Paid Basic / Pro users
- Platform breakdown
- Full account table with full email addresses
- Search by email
- 100 accounts per page with pagination
- Per-account links, minutes, failed jobs, Claude state and last activity

## Per-account management
Open any email from `/founder` to view `/founder/user/:id`.

Shows:
- full email + user ID
- plan / account status / trial eligibility
- current quota usage + remaining quota
- all-time successful links / minutes / failures
- Claude connection state
- recent jobs
- founder adjustment history

Founder can change:
- plan: Trial / Basic / Pro
- account status: active / past_due / canceled / disabled
- trial eligibility
- extra quota minutes
- extra trial links

Extra quota is added on top of the normal plan limit and does not rewrite/delete historical usage. Basic/Pro already have no link-count cap, so extra links mainly matter for Trial.

Manual plan changes can later be overwritten by Lemon Squeezy webhook state. The founder account cannot disable itself from the founder UI.

## Database additions
- `users.admin_bonus_seconds`
- `users.admin_bonus_videos`
- `founder_admin_events` audit table

The existing idempotent migration file adds them during the normal Railway pre-deploy migration.

## Validation
- `npx tsc -p tsconfig.check.json --pretty false`: PASS
- Full `npm run build` could not run in the local artifact environment because installed Node type definitions are absent; Railway build remains the final production compile gate.
