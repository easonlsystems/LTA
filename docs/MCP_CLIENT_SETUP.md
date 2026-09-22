# MCP integration setup

LTA uses the existing production Remote MCP endpoint:

```text
https://api-production-0383e.up.railway.app/mcp
```

No separate MCP implementation or API key is required. MCP clients authenticate through LTA OAuth.

## Claude Code

```bash
claude mcp add --transport http lta https://api-production-0383e.up.railway.app/mcp
claude mcp list
```

Open Claude Code and run `/mcp` if authentication is required. After LTA is connected, ask Claude Code to read a supported public URL. The primary tool is `read_public_link`.

## Codex

```bash
codex mcp add lta --url https://api-production-0383e.up.railway.app/mcp
codex mcp login lta
codex mcp list
```

In the Codex TUI, `/mcp` shows the active server. A normal source task can then use LTA's `read_public_link` tool.

## Standard MCP client / Inspector

```bash
npx @modelcontextprotocol/inspector
```

Choose **Streamable HTTP**, enter the LTA MCP URL, run the OAuth flow, then initialize/list tools and call `read_public_link` with a supported public URL.

## What should happen

The integration path is intentionally thin:

```text
URL
  -> existing LTA Remote MCP
  -> read_public_link
  -> shared source engine
  -> source result
```

Do not configure an `l2ai_live_...` REST API key in an MCP client. API keys are only for `/v1/*` REST integrations.
