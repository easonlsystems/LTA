# LTA — OpenAI first-release notes

## Version
3.0.0 — first public OpenAI Plugin Directory submission.

## What this ChatGPT distribution does
The public-directory `/mcp/openai` distribution is a first-party LTA account and planning companion. It can:
- check whether a user-provided URL string matches a source format recognized by LTA, without contacting the linked site;
- list LTA's current source compatibility categories;
- estimate LTA processing units from a duration or character count supplied by the user; and
- return the authenticated user's LTA plan and processing-unit balance.

## What this ChatGPT distribution does not do
It does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs.

The broader LTA product and the default/Claude MCP distribution may support external public-link reading. Those source-reading tools and provider paths are not exposed through the submitted `/mcp/openai` directory endpoint.

## Authentication
OAuth 2.1 authorization-code + PKCE. The ChatGPT distribution uses a dedicated OAuth resource audience bound to the production `/mcp/openai` endpoint. Normal users use Google sign-in. OpenAI reviewers receive dedicated no-MFA reviewer credentials privately through the submission portal.

## Reviewer notes
- `check_link_support` performs local URL parsing only and always reports `network_request_made=false`.
- `get_supported_sources` returns LTA-owned product capability metadata only.
- `estimate_processing_units` is a deterministic local calculation over user-supplied duration or character count.
- `get_usage` reads first-party LTA account usage only.
- All four tools are read-only, non-destructive, idempotent, and `openWorldHint=false`.
- No tool initiates purchases or returns checkout / upgrade / top-up links.
- The public ChatGPT distribution is general-audience only; adult-domain compatibility checks fail closed.
