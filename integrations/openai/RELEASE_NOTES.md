# Link2AI — OpenAI first-release notes

## Version
3.0.0 — first public OpenAI Plugin Directory submission.

## What Link2AI does
Link2AI reads supported exact public links when the host AI cannot reliably access the original source. It returns source identity, AI-readable source context, long-result continuation state, source-completeness metadata, and Link2AI quota/billing state.

## Production source categories advertised for this release
- YouTube / Shorts
- TikTok
- Instagram
- X
- Bluesky
- GitHub Issues / pull requests
- Hacker News discussions
- readable public webpages / articles
- public text-layer PDFs

Reddit is not advertised in this release unless approved Reddit OAuth API credentials are configured in production before submission.

## Authentication
OAuth 2.1 authorization-code + PKCE. Normal users use Google sign-in. OpenAI reviewers receive dedicated no-MFA reviewer credentials privately through the submission portal.

## Reviewer notes
- `read_public_link` can create/reuse a source-processing job and consume Link2AI processing units.
- `get_transcript_result` is read-only and continues/paginates an existing job.
- `get_usage` is read-only.
- Link2AI does not intentionally treat MCP delivery chunk size as a source-ingestion limit.
- Failed/unsupported reads consume 0 processing units.
- If an upstream provider does not expose a complete source, Link2AI reports that limitation instead of silently presenting it as complete.
