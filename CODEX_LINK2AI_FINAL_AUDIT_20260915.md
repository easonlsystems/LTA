# Link2AI final link-expansion audit — 2026-09-15

## Repository state

- Starting commit: `ac0c466c206a2b980d57379ebd042b800365fb81` (`Expand Link2AI to Reddit posts and public links`)
- Tested implementation commit: `456ce2d710479d68d8c1d78ae2af64aa699c92c3`
- Tested implementation tree: `399ad957329181a02f1b219142a0dd9b910c5c5e`
- Target branch: `main`
- This report and the cumulative ZIP are release artifacts created after the tested implementation commit. The final artifact commit is therefore reported by `git log -1` rather than self-referenced here.

## Features completed

- Bluesky individual public post routing and extraction through the public AT Protocol endpoint. Output includes author/handle, text, timestamp, one directly attached parent, quoted record when exposed, and external-card metadata.
- GitHub public Issue and Pull Request routing and extraction through unauthenticated public REST endpoints. Output includes repository/number, title, author, state, labels, body, PR branches/merged state, and a bounded set of issue comments/reviews.
- Hacker News item routing and extraction through the public Algolia HN item endpoint. Output includes story metadata/body/destination and at most 50 comments through depth four.
- Direct HTTPS `.pdf` links with a 12 MB wire cap, PDF signature and MIME checks, PDF.js text-layer-only extraction, page markers, bounded output, and clear malformed/password/no-text failures. PDF JavaScript, attachments, OCR, archive extraction, and embedded external fetching are not enabled.
- Platform types and MCP source description updated without renaming existing MCP tools.

## Confirmed bugs fixed

### Embedded credentials were accepted and silently removed

- Path: `src/media/url.ts`, `parseMediaUrl` / `cleanUrl`
- Reproduction: `parseMediaUrl('https://user:pass@example.com/a')` previously returned a normal web job.
- Expected: dangerous credential-bearing URL forms are rejected.
- Actual before fix: credentials were cleared during normalization.
- Severity: Major (URL-boundary ambiguity and possible secret mishandling).
- Fix: reject non-empty username/password before canonical cleanup.
- Regression: deterministic assertion in `test/pure.mjs`.

### Generic query-order variants produced different cache identities

- Path: `src/media/url.ts`, `cleanUrl`
- Reproduction: the same page with `?a=1&b=2` versus `?b=2&a=1` produced different `web_...` hashes.
- Expected: equivalent parameter ordering reuses the same canonical item.
- Actual before fix: query insertion order affected the hash.
- Severity: Major (duplicate jobs/quota risk for equivalent URLs).
- Fix: sort retained query parameters before hashing.
- Regression: equality assertion in `test/pure.mjs`.

## Tests added

- Valid/invalid Bluesky, GitHub Issue/PR, and Hacker News URL families.
- Hostname near-match classification, tracking removal, credential rejection, and query-order canonical dedupe.
- Deterministic Bluesky post/card/parent fixture.
- Deterministic GitHub issue/comment and PR/review/branch/merge fixtures.
- Deterministic nested Hacker News fixture and bounds-aware rendering.
- Generated valid text PDF fixture plus oversized, wrong-MIME, and invalid-signature cases.
- Existing YouTube, Shorts, TikTok, Instagram Reel/post, X, Reddit/redd.it, article, OAuth, billing, quota-adjacent, MCP, and runtime regressions remain in the full suite and pass.

## Commands and results

| Command | Result |
|---|---|
| `npm.cmd install pdfjs-dist@5.4.149 --save-exact` | PASS |
| `npm.cmd ci` | PASS; 80 packages installed; audit reported 0 vulnerabilities |
| `npm.cmd run build` | PASS |
| `npm.cmd test` | PASS: pure, billing, MCP smoke, runtime smoke |
| `npm.cmd audit --audit-level=high` | PASS; 0 vulnerabilities |
| `git diff --check` | PASS |
| `docker build -t link2ai:codex-finished-20260915 .` | NOT RUN: `docker` executable is unavailable on this host |
| `railway status` | BLOCKED: CLI is installed but unauthenticated |

## Compatibility and safety review

- Existing MCP IDs `get_video_transcript`, `get_transcript_result`, and `get_usage` are unchanged; MCP smoke tests pass.
- New remote reads use the existing DNS/IP-pinned HTTPS boundary, redirect-by-redirect public-address validation, identity encoding, explicit timeouts, response byte limits, and `Accept-Encoding: identity`.
- Extracted text remains bounded and is described to clients as untrusted external content.
- No database schema or migration changes were introduced.
- Existing per-user result query isolation and canonical media claims were preserved.

## Known limitations and production acceptance

- Threads was intentionally not added: a clean, stable unauthenticated public API path was not established.
- Bluesky handle and DID aliases cannot be guaranteed to share a cache identity until handle-to-DID resolution is incorporated before job creation. Normal URL/tracking variants do deduplicate.
- PDF support is text-layer only; scanned/image-only and encrypted PDFs fail clearly. The test run emits a PDF.js standard-font-data warning for the synthetic Helvetica fixture, but extraction succeeds.
- GitHub public API rate limits are surfaced as extraction failures; no token or bypass behavior was added.
- No live third-party smoke matrix was run from this environment. Deterministic fixtures are the acceptance evidence for new extractors.
- Docker build, fresh/current-production-shape migration execution, Railway API/Worker deploy, health/log checks, and live production smoke tests remain unverified for the exact environmental reasons above.

## Completion status

Source implementation and local automated verification: **PASS**.

Production acceptance: **BLOCKED / NOT COMPLETE** because Docker is unavailable and Railway is unauthenticated. This release must not be described as fully deployed or production-accepted until the steps in `LINK2AI_CODEX_DEPLOY_NOTES_20260915.md` pass.
