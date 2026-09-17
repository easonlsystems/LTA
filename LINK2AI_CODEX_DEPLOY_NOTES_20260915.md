# Link2AI deploy notes — 2026-09-15

## Release contents

The patch adds Bluesky posts, GitHub issues/pull requests, Hacker News items, and text-layer PDFs. It adds one pinned runtime dependency: `pdfjs-dist@5.4.149`. No new environment variables and no database schema changes are required.

## Pre-deploy verification

From the repository root:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd audit --audit-level=high
docker build -t link2ai:20260915 .
```

Expected: every command exits zero. The Docker build was not executable on the authoring host because Docker was not installed; it must be run in CI or on the deployment host.

## Migration

There are no migration changes in this patch. Still run the repository's idempotent migration once using the production `DATABASE_URL` before service promotion:

```powershell
npm.cmd run build
npm.cmd run db:migrate:prod
```

Verify first on a fresh database and then against a current-production-shaped backup/staging database. Do not reset or drop production data.

## Railway deployment

1. Authenticate and link the correct Railway project/environment.
2. Confirm the API and Worker services both build from the same final Git commit.
3. Run `npm run db:migrate:prod` as the migration/release command.
4. Deploy the API service with `npm run start:api` and the Worker service with `npm run start:worker` using the existing topology.
5. Confirm `/healthz` returns HTTP 200 and `/readyz` returns HTTP 200.
6. Inspect both service logs for startup failures, worker retry/crash loops, unhandled rejections, PDF.js load errors, and database errors.

The local Railway CLI returned `Unauthorized. Please login with railway login`; no deploy was attempted.

## Production smoke matrix

Using a test account with observable quota, process one known public URL for each class: YouTube, Instagram Reel, Instagram post, TikTok video, X post, generic article, Bluesky post, GitHub issue or PR, Hacker News item, and a small text-layer PDF. Test Reddit standard/redd.it/share forms only when Reddit OAuth credentials are configured; without them Reddit must remain unadvertised and fail cleanly.

For each successful item, verify metadata, readable text, paging, cache reuse, and that a repeat canonical URL does not charge again for that user. Then submit an unsupported profile/feed URL, a localhost/private-network URL, and a failed document response; verify clean model-usable errors and no finalized quota charge.

Finally confirm the legacy MCP tools still enumerate and execute under their unchanged IDs:

- `get_video_transcript`
- `get_transcript_result`
- `get_usage`
