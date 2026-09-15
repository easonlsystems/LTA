# Link2AI Website Analytics — 2026-09-15

Baseline: production commit `c9f3b03` (`Add founder admin dashboard and support email frontend`).

This package adds first-party website traffic analytics directly to `/founder`.

## Added

- Anonymous first-party visitor cookie (`link2ai_visitor`), random UUID only.
- No IP address storage and no third-party analytics service.
- Tracks public acquisition pages: `/`, `/connect`, `/support`, `/pricing`, `/login`, `/signup`.
- Unique visitors: today, 7 days, all-time from analytics launch.
- Page views: today, 7 days, all-time from analytics launch.
- Non-founder visitors seen in the last 7 days.
- Website funnel: visitor -> connect page -> signup -> first successful link.
- Top website pages in the last 7 days.
- Visitor is associated with the Link2AI account after sign-in; password registration marks a visitor signup.
- Privacy Policy updated to disclose first-party analytics.

## Database

`sql/001_init.sql` adds:

- `website_visitors`
- `website_pageviews`

The existing Railway API pre-deploy command (`npm run db:migrate:prod`) applies the migration automatically.

## Important

Traffic before this release cannot be reconstructed. Website analytics begin after this release reaches production.

## Files in this update

- `sql/001_init.sql`
- `src/api/main.ts`
- `src/auth/routes.ts`
- `src/billing/routes.ts`
- `src/analytics/visitors.ts`

## Validation

TypeScript syntax parsing passed for all changed TypeScript files. Full dependency-aware build remains the Railway/GitHub deployment gate because this update bundle contains only changed files rather than the complete repository/node_modules.
