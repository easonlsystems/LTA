# Link2AI usage-limits deployment notes — 2026-09-15

## Compatibility model

No environment variables, prices, plan allowance numbers, or public tool IDs change. One processing unit is represented as 60 seconds in the existing ledger/reservation columns. Historical data is not converted or rewritten.

The existing MCP IDs remain:

- `get_video_transcript`
- `get_transcript_result`
- `get_usage`

## Required order

1. Back up or snapshot the production database.
2. Build and test the exact release commit.
3. Run the idempotent migration before starting either new service version.
4. Deploy API and Worker from the same commit.
5. Verify health, logs, accounting, cache reuse, and truncation metadata.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd audit --audit-level=high
npm.cmd run db:migrate:prod
docker build -t link2ai:usage-limits-20260915 .
```

## Migration checks

Verify `transcript_cache` contains the new completeness columns and that existing cache/ledger/job counts are unchanged. Run the migration twice in staging to confirm idempotency. Verify a legacy cached result with zero persisted usage metadata is still returned with derived `usage_units` and `extracted_token_estimate`.

## Production smoke checks

- Confirm API `/healthz` and `/readyz` return 200 and Worker logs show normal polling.
- Process a 1–2,500-token text result: exactly 1 unit / 60 compatibility seconds.
- Process a 2,501–5,000-token text result: exactly 2 units / 120 compatibility seconds.
- Process 60- and 61-second videos: 1 and 2 units respectively.
- Repeat the same canonical item for the same user: no second charge.
- Submit concurrent jobs near a user's limit: total finalized plus reserved usage must not exceed the allowance.
- Force a retry after reservation: only one ledger row may exist for the job.
- Verify unsupported, private/login-only, no-text PDF, and extraction failures finalize zero usage.
- Verify oversized article/thread/PR/PDF results set `truncated`, accurate available/extracted counts where known, and a human-readable MCP warning.
- Verify existing OAuth, billing webhook, founder control, cache, job-ownership, and legacy MCP flows.

## Rollout notes

Deploy migration-first because new binaries select and write the new cache columns. A code rollback remains compatible with the additive columns. Do not roll back by deleting the columns or rewriting historical ledger rows.

Docker and Railway acceptance were unavailable on the authoring host: Docker is not installed and `railway status` reports that login is required.
