# Link2AI usage and extraction-limits audit — 2026-09-15

## Repository state

- Baseline: `2f54db4b907948fd044a3a5ce85f05f5d6c52fb0`
- Tested implementation commit: `f236573` (`Refactor usage metering around processed content`)
- Branch: `main`
- Scope: backend/core only. No public website, pricing, FAQ, support, connect, navigation, SEO, or layout copy was modified.

## Accounting implemented

- One processing unit is stored as 60 seconds in the existing quota tables. This is a compatibility layer: historical ledger rows and balances are not rewritten, existing plan allowances and prices remain unchanged, and founder/billing fields remain available.
- Successful video: `max(1, ceil(processed_duration_seconds / 60))` units.
- Successful text: estimate tokens deterministically as `ceil(Unicode_code_points / 4)`, then charge `max(1, ceil(extracted_token_estimate / 2500))` units.
- Empty or unsuccessful outcomes produce zero units. Unsupported/private/login-required/extraction/runtime failures never finalize a ledger row.
- Text work reserves the one-unit minimum, extracts useful bounded content, then reconciles the same reservation to actual units before idempotent finalization.
- Retry idempotency remains keyed by the unique ledger `job_id`. Reservation reconciliation excludes the current job from competing reservations.
- The user row remains locked with `FOR UPDATE` while ledger plus competing reservations are evaluated, preventing concurrent overspend.
- Link/item count is no longer enforced for any plan. The legacy `videos` ledger/display fields remain populated for compatibility but are not an entitlement gate.

## Centralized extraction limits

Defined in `src/content/limits.ts`:

| Content class | Token budget | Secondary cap |
|---|---:|---|
| Generic webpage/article | 30,000 | 2.5 MB response |
| Reddit/Hacker News discussion | 30,000 | 500 items, depth 4, 3 MB response |
| GitHub Issue | 30,000 | 300 discussion items, bounded API responses |
| GitHub Pull Request | 40,000 | 300 discussion items, 5 MB diff response |
| Text-layer PDF | 50,000 | 100 pages, 12 MB response |
| Short social post | 12,000 | existing bounded platform response/process limits |

Root post/story and issue/PR metadata/body are included before discussion. PR diff is last and can be truncated independently. PDF extraction stops at the page or content budget. Generic HTML continues to prefer article/main/body content after removal of common boilerplate regions.

## Completeness schema

Successful cached/API/MCP results now carry:

- `truncated`
- `truncation_reason`
- `extracted_token_estimate`
- `usage_units`
- optional item/page available and extracted counts
- `content_sections_truncated`

When `truncated` is true, the MCP limitation notice explicitly warns the host AI that only part of the source was processed and includes page/section detail when known. Paging through an otherwise complete MCP result remains separate from source truncation.

## Migration behavior

`sql/001_init.sql` uses idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for completeness fields on `transcript_cache`. Existing cache rows receive safe zero/false/empty defaults. Runtime fallback derives units and token estimates for a legacy cached row whose new counters are zero. No rows, accounts, jobs, ledger entries, subscriptions, founder controls, or historical balances are dropped or rewritten.

Deployment order must run the migration before starting the new API/Worker because queries reference the new cache columns.

## Tests and verification

- `npm.cmd ci`: PASS; 80 packages; zero install audit findings.
- `npm.cmd run build`: PASS through the full test command.
- `npm.cmd test`: PASS.
  - pure/extractor/router tests
  - new quota tests
  - billing tests
  - MCP smoke tests, including legacy tool IDs
  - runtime/auth/public-route smoke tests
- `npm.cmd audit --audit-level=high`: PASS; zero vulnerabilities.
- `git diff --check`: PASS.
- Docker build: NOT RUN; Docker executable is unavailable.
- Railway/live acceptance: NOT RUN; local Railway CLI is unauthenticated.

New deterministic coverage includes usage boundaries, video rounding, zero-unit failures, legacy-seconds conversion, content truncation, more than 40 Reddit comments, HN depth bounding, giant PR diff degradation, scanned/no-text PDF failure, current-job reservation reconciliation, row locking, and retry/finalization idempotency.

## Confirmed defect fixed during verification

The runtime smoke test used a 10-second startup deadline. On a cold Windows/OneDrive dependency load, the API became healthy after that deadline with no crash output and returned HTTP 200 immediately afterward. The bounded deadline is now 45 seconds. Production startup code was not changed.

## Known limitations / remaining production verification

- The deterministic token estimate is intentionally approximate; later benchmark data may justify a tokenizer or different divisor.
- User-remaining-budget-aware source clipping is not performed before extraction. The minimum unit is rejected up front; a larger successful extraction that exceeds remaining quota is discarded and charged zero rather than silently overspending.
- GitHub public API rate limits and upstream pagination cap the available discussion material; unavailable totals are not invented.
- PDF remains text-layer only; OCR is not enabled. Synthetic PDF tests emit a PDF.js standard-font-data warning while still passing extraction.
- Fresh/current-production-shaped migration execution, Docker image build, Railway deploy, API/Worker same-commit confirmation, deploy logs, health checks, and live third-party smoke tests still require an authenticated production environment.

Local source/test acceptance is PASS. Production acceptance remains unverified for the explicit environmental reasons above.
