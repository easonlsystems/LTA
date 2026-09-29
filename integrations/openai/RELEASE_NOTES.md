# LTA — OpenAI first-release notes

## Version
3.0.0 — first public OpenAI Plugin Directory submission.

## What LTA does
LTA reads supported exact public links when the host AI cannot reliably access the original source. It returns source identity, AI-readable source context, long-result continuation state, source-completeness metadata, and LTA processing-unit state.

## Production source categories advertised for this ChatGPT release
The ChatGPT-specific distribution uses the same supported-source matrix as LTA's default/Claude distribution:
- YouTube videos and YouTube Shorts
- TikTok videos and supported public posts
- Instagram Reels and supported public posts
- Individual public X posts
- Individual public Bluesky posts
- Public GitHub Issues / pull requests and public discussion
- Hacker News public items / discussions
- Readable public HTTPS webpages / articles
- Direct public text-layer PDFs
- Individual public Reddit posts when approved Reddit OAuth Data API credentials are configured

LTA still does not support profiles, feeds, timelines, broad crawling, private/login-only content, paywall or DRM bypass, or visual-only details that are not represented in returned text.

## Authentication
OAuth 2.1 authorization-code + PKCE. The ChatGPT distribution uses a dedicated OAuth resource audience bound to the production `/mcp/openai` endpoint. Normal users use Google sign-in. OpenAI reviewers receive dedicated no-MFA reviewer credentials privately through the submission portal.

## Reviewer notes
- `read_public_link` can create/reuse a supported source-processing job and consume LTA processing units.
- `read_public_links` keeps each supported source separate.
- `get_transcript_result` is read-only and continues/paginates an existing job.
- `get_visual_assets` is read-only and delivers attached images from an already processed supported social-post job without charging processing units again.
- `find_in_link` searches an already processed source.
- `get_usage` is read-only.
- The ChatGPT-specific endpoint intentionally keeps a six-tool surface even though its supported-source matrix matches the default/Claude distribution.
- Failed/unsupported reads consume 0 processing units.
- Returned source text is treated as untrusted external content, and incomplete upstream results are reported honestly rather than fabricated.
