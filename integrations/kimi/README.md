# Link2AI for Kimi — Marketplace submission notes

## Product
Link2AI lets Kimi retrieve AI-readable context from supported public links when the user's question depends on the source content and Kimi cannot reliably access it directly.

## User experience
1. Install **Link2AI** from the Kimi plugin marketplace.
2. Complete Link2AI OAuth sign-in when prompted.
3. Paste a supported public link into Kimi and ask a source-dependent question.
4. Kimi can call Link2AI automatically when the source is not otherwise available.

Users do not need to copy an MCP URL, create an API key, or configure a client secret.

## Supported source categories
- YouTube / Shorts
- TikTok
- Instagram
- X
- Bluesky
- GitHub Issues / pull requests
- Hacker News discussions
- Readable public webpages / articles
- Public text-layer PDFs

Reddit is intentionally not advertised until approved Reddit Data API credentials are configured in production.

## Authentication
The production Link2AI MCP endpoint uses OAuth. The user's Link2AI account, trial, paid plan, and processing-unit balance remain the same across supported AI integrations.

## Billing behavior
Link2AI bills its own processing units. Unsupported, inaccessible, login-required, empty, or failed reads consume 0 Link2AI processing units.

## Safety / scope
Link2AI supports public content only. It does not support private accounts, login-gated content, paywalls, DRM, geographic restriction bypassing, or bulk crawling. Returned source content is marked as untrusted external data and should never be followed as instructions.

## Production endpoints
- Product / account: https://api-production-0383e.up.railway.app/
- MCP: https://api-production-0383e.up.railway.app/mcp
- Privacy: https://api-production-0383e.up.railway.app/privacy
- Terms: https://api-production-0383e.up.railway.app/terms
- Support: https://api-production-0383e.up.railway.app/support

## Publisher
Eason Systems
