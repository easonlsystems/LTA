# Claude Connectors Directory submission pack

Status: PREPARED, NOT CLEARED FOR SUBMISSION

This file mirrors the current Claude.ai remote MCP submission portal so the listing can be reviewed before anything is submitted.

## Connection

- Connector: Link2AI
- Type: Remote MCP server
- Transport: Streamable HTTP
- Server URL: use the production PUBLIC_BASE_URL + `/mcp`
- User URL model: same server URL for every user
- Authentication: OAuth 2.0 with dynamic client registration

## Listing

- Name: Link2AI
- Tagline: Public links into AI-ready source context
- Suggested categories: Productivity, Developer Tools, Research
- Documentation URL: production `/connect`
- Privacy policy URL: production `/privacy`
- Support: production `/support` and the configured support contact
- Company: Eason Systems
- Website: production Link2AI site
- Slug: choose carefully in the portal because the published slug is permanent

### Description

Link2AI turns supported public links into source context Claude can read and reason over. It supports public videos and social posts, GitHub Issue and pull-request discussions, Hacker News threads, readable webpages and text-layer PDFs. Link2AI preserves source identity, completeness and provenance metadata, and reports limitations rather than silently presenting an incomplete source as complete. Successful reads consume Link2AI processing units; failed or unsupported reads consume 0 units.

## Use cases

1. Read a public video or social post when the user needs its spoken, captioned or available public text content in Claude.
2. Read a GitHub Issue or pull request discussion and use the retrieved source context for engineering review, debugging or planning.
3. Read a long public webpage, Hacker News thread or text-layer PDF and locate the parts relevant to a research question.
4. Compare multiple supported public links while keeping each source identity and completeness state separate.

Prerequisites: a Link2AI account. New accounts can start with the available trial allowance. Link2AI is read-oriented: it creates internal processing jobs and usage records but does not edit the public source.

## Authentication

- OAuth 2.0
- Dynamic client registration supported
- Reviewer credentials must be supplied only through the Claude submission portal or another approved secure channel.
- Never commit reviewer passwords, access tokens, client secrets or API keys to this repository.

## Data handling answer

Link2AI owns and operates its MCP/API endpoint and website. The product retrieves user-selected public resources from third-party websites and APIs that Link2AI does not own or control.

This answer must be entered accurately in the portal. Do not characterize those third-party public resources as first-party Link2AI data.

## Test and launch checklist

Before submission:

- Connect the production MCP server through Claude as a fresh user.
- Exercise every advertised tool at least once.
- Test OAuth from a clean session.
- Test one quick text source and one async media source.
- Test a failed/unsupported source and confirm 0 units charged.
- Test a quota-blocked source and confirm remaining + required units are shown when known.
- Test continuation on a source larger than one MCP result.
- Confirm titles and applicable annotations are present for every exposed tool.
- Confirm no secrets or internal logs appear in user-visible tool results.
- Provide a fully usable reviewer account through the secure portal fields.

## Policy blocker — do not submit yet

The current Anthropic Software Directory Policy requires developers to verify that they own or control the external resources their software retrieves or renders. Link2AI intentionally reads arbitrary supported third-party public URLs selected by the user, so this requirement is not currently satisfied on its face.

The submission portal explicitly has a data-handling option for a third party API the developer does not control, but that portal field does not override the Directory Policy.

Do not make the required first-party/compliance acknowledgment and do not submit Link2AI to the public Directory until Anthropic provides written clarification or permission that Link2AI's user-directed public-URL model is eligible.

Custom-connector use can continue independently of public Directory approval.
