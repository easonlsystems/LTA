# Link2AI Cumulative Update — Website Analytics + 中文 Founder 後台 — 2026-09-15

Baseline: production commit `c9f3b03` (`Add founder admin dashboard and support email frontend`).

This is the cumulative package to use next. It includes the previously prepared website analytics update plus a Traditional Chinese founder/admin UI. Do not apply the older `Link2AI_WEBSITE_ANALYTICS_20260915.zip` first.

## 1. Website analytics

- Anonymous first-party visitor cookie (`link2ai_visitor`), random UUID only.
- No IP address storage and no third-party analytics service.
- Tracks `/`, `/connect`, `/support`, `/pricing`, `/login`, `/signup`.
- Unique visitors, page views, non-founder visitors, signup conversion and activation funnel.
- Top website pages for the last 7 days.
- Associates the anonymous visitor with the Link2AI account after sign-in/signup.
- Privacy disclosure included.

Traffic before this release cannot be backfilled. Analytics start after this version reaches production.

## 2. Founder dashboard Chinese localization

`/founder` and `/founder/user/:id` are displayed in Traditional Chinese, including:

- visitor / page-view cards
- account / Claude / successful-link / paid-user cards
- website and product funnels
- all-account table, search and pagination
- recent jobs
- account detail cards
- plan, status, trial eligibility, bonus minutes and bonus links controls
- save/result messages
- founder adjustment history headings
- founder-only navigation/footer chrome
- Taipei timestamps rendered with `zh-TW`

Internal values are intentionally unchanged. Examples:

- `trial`, `basic`, `pro`
- `active`, `past_due`, `canceled`, `disabled`
- job status values

Only display labels are translated, so billing, webhook and database behavior remain compatible.

## Database

`sql/001_init.sql` adds website analytics tables:

- `website_visitors`
- `website_pageviews`

Railway API already runs `npm run db:migrate:prod` as the pre-deploy command, so the migration is applied automatically on deploy.

## Files in this update

- `sql/001_init.sql`
- `src/api/main.ts`
- `src/auth/routes.ts`
- `src/billing/routes.ts`
- `src/analytics/visitors.ts`

## Validation

TypeScript transpile/syntax validation passed for every changed `.ts` file in the package. Full dependency-aware build and migration remain the Railway deployment gate.
