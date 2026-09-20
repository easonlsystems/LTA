# Link2AI on Grok — custom MCP connector

Link2AI's production MCP endpoint is already compatible with Grok's documented custom MCP connector flow. Grok connects to the same Link2AI MCP server and therefore uses the same source engine, jobs, cache, quota, completeness and provenance behavior as Claude.

## Consumer setup

1. Open Grok Connectors.
2. Choose **New Connector** → **Custom**.
3. Enter:
   `https://api-production-0383e.up.railway.app/mcp`
4. Complete Link2AI authentication if Grok prompts for it.
5. In a Grok conversation, provide one supported public URL and ask for the source contents or analysis grounded in that source.

No Link2AI API key belongs in the Grok custom-connector form.

## xAI API / Remote MCP configuration

For applications using xAI's Remote MCP tool support, use the values in `mcp.json`.

The recommended modern tool set excludes the legacy `get_video_transcript` compatibility alias:

- `read_public_link`
- `read_public_links`
- `get_transcript_result`
- `get_video_time_range`
- `find_in_link`
- `get_video_map`
- `get_usage`

xAI API callers are responsible for supplying an authorization token when using Remote MCP programmatically. Do not commit Link2AI access tokens or xAI API keys.

## Product behavior

Grok is a client of Link2AI, not a separate extraction implementation.

```text
Grok
  → Link2AI MCP
  → Shared Source Engine
  → job / cache / quota / provenance
  → provider routing / extraction
```

A source processed through Grok must follow the same source identity, quota, cache and completeness rules as the same source processed through Claude or the public API.

## Current distribution state

Custom MCP use is technically available through Grok's documented connector flow.

Catalog distribution is separate. Link2AI's catalog request package lives in `CATALOG_REQUEST.md` and `REQUEST_EMAIL.md`. Do not claim Catalog publication until xAI has actually approved and listed Link2AI.
