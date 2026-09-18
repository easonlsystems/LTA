# Link2AI — OpenAI first-release notes

## Version
3.0.0 — first public OpenAI Plugin Directory submission.

## What Link2AI does
Link2AI reads supported exact public links when the host AI cannot reliably access the original source. It returns source identity, AI-readable source context, long-result continuation state, source-completeness metadata, and Link2AI processing-unit state.

## Production source categories advertised for this ChatGPT release
- Bluesky public posts and public replies, through the public AT Protocol API
- GitHub public Issues / pull requests and public discussion, through the GitHub API
- Hacker News public items / discussions, through the official Hacker News Firebase API

Other Link2AI source categories are intentionally blocked on the ChatGPT-specific MCP endpoint unless a separately authorized retrieval path is added and reviewed later. This includes YouTube / Shorts, TikTok, Instagram, X, Reddit, arbitrary webpages, and arbitrary PDFs.

## Authentication
OAuth 2.1 authorization-code + PKCE. The ChatGPT distribution uses a dedicated OAuth resource audience bound to the production `/mcp/openai` endpoint. Normal users use Google sign-in. OpenAI reviewers receive dedicated no-MFA reviewer credentials privately through the submission portal.

## Reviewer notes
- `read_public_link` can create/reuse a permitted source-processing job and consume Link2AI processing units.
- `read_public_links` keeps each permitted source separate.
- `get_transcript_result` is read-only and continues/paginates an existing permitted job.
- `find_in_link` searches an already processed permitted source.
- `get_usage` is read-only.
- The ChatGPT-specific endpoint does not expose video-only follow-up tools because video sources are not enabled for this distribution.
- Blocked source categories fail before source retrieval or quota consumption.
- A job id created through another Link2AI distribution cannot be used to bypass the ChatGPT source policy.
- Failed/unsupported reads consume 0 processing units.
