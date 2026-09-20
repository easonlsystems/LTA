# Ready-to-send xAI request

Subject: Grok Connector Catalog distribution request — LTA

Hello xAI team,

I'm building LTA, source infrastructure for AI assistants. LTA turns supported public URLs selected by the user into AI-ready source context with source identity, completeness, and provenance metadata.

We would like to publish LTA as a pre-configured OAuth connector in the Grok Connector Catalog so normal Grok users can search for LTA, click Connect, authorize their LTA account, and use it without manually entering an MCP URL.

Production MCP endpoint:
https://api-production-0383e.up.railway.app/mcp

LTA already supports OAuth 2.0 authorization-code + PKCE, MCP protected-resource discovery, dynamic client registration, per-user authorization, long-result continuation, quota/billing handling, and source-completeness signaling. The same production MCP endpoint is also compatible with Grok's documented Custom MCP connector flow.

Current public-source categories include YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issues/PRs, Hacker News, readable webpages, and text-layer PDFs. LTA does not provide source-platform write actions, broad crawling, private-account access, or paywall/DRM bypassing.

Website:
https://api-production-0383e.up.railway.app/

Privacy:
https://api-production-0383e.up.railway.app/privacy

Terms:
https://api-production-0383e.up.railway.app/terms

Support:
https://api-production-0383e.up.railway.app/support

Could you point us to the onboarding/review process for adding a third-party OAuth connector to the Grok Connector Catalog?

We can provide reviewer credentials, technical metadata, test cases, and any additional security/privacy information required.

Thank you,
Eason Systems
