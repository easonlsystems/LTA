# Link2AI — Historical analytics backfill — 2026-09-15

Base: current production after `Add website analytics and localize founder dashboard` (`5c19b6525d2238d9734b7d3981c1676743d232f6`).

## What this update does

This is a one-time backfill for website traffic that happened before first-party analytics was enabled.

- Reads only the historical request evidence already recovered from Railway HTTP logs.
- Obvious bots/crawlers/scanners were excluded.
- Historical unique visitors are estimated from request identity signals and converted to anonymous synthetic UUIDs before import.
- Raw IP addresses and raw User-Agent strings are not inserted into Link2AI's database or committed in this package.
- Historical page path + timestamp are imported into the existing website analytics tables.
- Founder historical browser traffic is linked back to the configured founder account where possible so it does not inflate the non-Founder visitor card.
- The import is idempotent: redeploying the same update does not duplicate historical pageviews.

Recovered dataset in this package:

- 8 estimated historical unique visitors total
- 33 historical pageviews
- 1 known Founder historical visitor + 7 other estimated visitors

Historical backfill includes `/`, `/connect`, `/login`, `/signup`, and `/pricing` page visits where the old logs were sufficient to identify them. It does not attempt to infer whether a historical signup page visit actually completed registration.

## Founder dashboard changes

`/founder` now shows historical-backfill counts directly in the visitor and page-view cards, and clearly labels the recovered data as estimated historical traffic.

The privacy copy also explains the one-time backfill and confirms that raw IP/User-Agent values were not imported.

## Files

- `sql/001_init.sql`
- `src/api/main.ts`

## Validation

- TypeScript syntax transpile check: PASS
- Historical import uses deterministic source keys + `ON CONFLICT DO NOTHING`, so the same package can be safely redeployed without duplicating imported pageviews.
