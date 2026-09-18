# Link2AI — Grok Connector Catalog distribution request

## Distribution goal

Publish **Link2AI** as a pre-configured OAuth connector in the Grok Connector Catalog.

The production launch standard is:

`Grok user → Connectors → search Link2AI → Connect → Link2AI OAuth → use`

Normal users must not need to copy an MCP URL, enable a developer mode, create an API key, or configure a client secret.

## Product

Link2AI is a source-reading layer for AI systems. It retrieves AI-readable context from supported public links when the host AI cannot reliably access the original source itself.

Primary use case:

`user provides exact public URL → Grok native access is missing/incomplete → Link2AI reads exact source → Grok answers from returned source context`

Link2AI does not provide broad crawling, profile/feed scraping, private-account access, paywall bypassing, DRM bypassing, or source-platform write actions.

## Production endpoint

Remote MCP:

`https://api-production-0383e.up.railway.app/mcp`

Product / account:

`https://api-production-0383e.up.railway.app/`

Support:

`https://api-production-0383e.up.railway.app/support`

Privacy:

`https://api-production-0383e.up.railway.app/privacy`

Terms:

`https://api-production-0383e.up.railway.app/terms`

## Authentication

OAuth 2.1 authorization-code flow with PKCE.

Resource scope:

`link2ai:read`

The server publishes MCP protected-resource metadata and OAuth authorization-server metadata, supports dynamic client registration, refresh tokens, and validates the authenticated Link2AI user on every MCP tool call.

Normal users sign in to Link2AI with Google. A dedicated no-MFA reviewer login exists for marketplace/integration review and is configured through production-only `REVIEWER_EMAIL` / `REVIEWER_PASSWORD` values.

## Tools

### read_public_link
Starts or reuses a source-reading job for one exact supported public URL. A normal call reuses a still-valid prior result for the same user/source; `refresh=true` is reserved for explicit freshness/update requests.

### read_public_links
Starts or reuses multiple exact public-source jobs for comparison or synthesis while preserving each source identity, job id, completeness state, and continuation offset independently.

### get_transcript_result
Continues a processing job and paginates long source content.

### get_video_time_range
Reads timestamped transcript/caption segments from an already processed video job without re-reading or re-charging the source.

### find_in_link
Searches an already processed source for likely relevant transcript/text regions without re-reading or re-charging it. It is a locator rather than semantic proof; Grok should read surrounding context before answering and must not treat a search miss as proof of absence.

### get_video_map
Returns a compact timeline map for an already processed video, covering the full available timeline with time ranges, transcript excerpts, and deterministic keywords. It is a navigation aid; Grok should read exact relevant ranges before making detailed claims.

### get_usage
Returns the connected Link2AI account's plan and processing-unit balance.

### get_video_transcript
Compatibility alias retained for already-connected Link2AI clients. New integrations should use `read_public_link`.

## Source completeness

Link2AI does not intentionally truncate a supported source because of a product-defined token, page-count, discussion-count, or video-duration cap.

Account processing units are the product-level source-size budget:
- video: 1 unit per started processed minute;
- text: about 1 unit per 2,500 estimated tokens.

If the account cannot afford the complete supported source, Link2AI stops and returns a quota/payment-required state rather than publishing an intentionally partial success.

MCP delivery is paginated at up to 50,000 characters per response. This is transport pagination, not source-ingestion truncation.

If an upstream platform itself exposes only partial data, Link2AI marks the source as partial/unverified rather than presenting it as complete.

## Supported source categories

Currently advertised in production:
- YouTube / Shorts
- TikTok
- Instagram
- X
- Bluesky
- GitHub Issues / pull requests
- Hacker News discussions
- readable public webpages / articles
- public text-layer PDFs

Reddit is deliberately not advertised until approved Reddit Data API OAuth credentials are configured in production.

## Data and actions

Link2AI reads public-source content requested by the user. It does not post, like, follow, edit, delete, send messages, or mutate content on source platforms.

Link2AI account authentication, plan, quota, billing state and temporary processing jobs are handled on Link2AI infrastructure according to the published privacy policy and terms.

## Requested Catalog UX

Catalog name: **Link2AI**

Short description: **Read public links Grok cannot reliably access.**

Connection:
1. User chooses Link2AI in the Grok Connector Catalog.
2. Grok starts Link2AI OAuth.
3. User signs in / authorizes Link2AI.
4. Connector is ready in Grok.

No user-visible MCP URL configuration should be required.

## Production acceptance

Catalog publication is not considered complete until a normal Grok consumer account can:

1. find Link2AI in the standard Connector Catalog;
2. connect via Link2AI OAuth without manual MCP configuration;
3. ask a question that depends on an exact supported public URL;
4. have Grok invoke Link2AI when native source access is insufficient;
5. receive the correct source identity and source content;
6. continue long results until required context is delivered;
7. receive a clear quota/payment-required result when full processing exceeds the Link2AI balance;
8. reuse the same source in follow-up questions without unnecessary reprocessing or double charging;
9. compare multiple links without collapsing source attribution;
10. answer timestamp-specific video questions from the existing processed job without re-reading the video;
11. locate relevant regions inside long processed sources before loading broader context, without reprocessing the source;
12. inspect a compact full-video timeline map for broad whole-video questions, then load exact time ranges for evidence.

## Distribution status

As of 2026-09-18, xAI publicly documents:
- the Grok Connector Catalog for pre-configured OAuth third-party connectors;
- Custom MCP connectors for manually supplied servers.

The public documentation does not document a self-service third-party vendor submission schema or Catalog publishing portal. Therefore the remaining non-technical blocker is xAI distribution approval / onboarding.

Official references:
- https://docs.x.ai/grok/connectors
- https://x.ai/contact

Recommended request channel: xAI Product Support / partnership contact, asking specifically for **Grok Connector Catalog third-party distribution onboarding**.
