# Link2AI Claude install-link fix — 2026-09-15

Fixes the Claude onboarding CTA to use Anthropic's current custom-connector install URL.

Before:
- `https://claude.ai/settings/connectors`
- query params `mcpName` / `mcpServerUrl`

After:
- `https://claude.ai/customize/connectors`
- query params `connectorName` / `connectorUrl`

The corrected link opens Claude's **Customize → Connectors → Add custom connector** dialog directly with Link2AI's name and MCP URL prefilled.
