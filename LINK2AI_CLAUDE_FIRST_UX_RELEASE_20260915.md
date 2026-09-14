# Link2AI Claude-first UX release — 2026-09-15

This cumulative update is based on the Instagram duration recovery build and keeps the prior OpenAI review metadata fix.

## Product changes

- Founding beta is positioned Claude-first. ChatGPT remains a first-class next target rather than blocking beta distribution.
- Homepage redesigned from scratch around the real behavior: paste a link in Claude, Link2AI steps in only when the answer depends on inaccessible link content.
- Added a direct **Add to Claude** path that opens Claude's custom connector form with Link2AI name and MCP URL pre-filled.
- Manual MCP copying is now a fallback hidden under troubleshooting instead of the primary onboarding path.
- Setup copy is reduced to: Open setup → Continue/Add → Connect/Continue free → paste a link and ask normally.
- First-use permission behavior is explained without requiring users to understand MCP.
- Pricing and supported-platform copy remain link-first and transcript-context oriented.
- Auth/consent screens were restyled to match the product instead of looking like a raw developer form.

## OAuth onboarding change

- Authorization server metadata no longer advertises `client_id_metadata_document_supported` during the Claude-first beta.
- DCR remains enabled through `/oauth/register` and is the preferred automatic Claude client-registration path.
- This avoids the server-side dependency on fetching Claude's public CIMD document, which can be blocked by claude.ai edge protection from some cloud egress IPs.
- CIMD parsing code remains in the backend for compatibility with explicit URL-form client IDs; it is simply no longer advertised as the preferred discovery path.

## Preserved behavior

- Claude should call `Read link content` only when the request depends on content behind a supported public link and Claude does not already have sufficient access.
- `get_video_transcript` remains non-read-only because successful calls can enqueue jobs and consume Link2AI quota.
- Instagram missing-duration recovery via ffprobe is preserved.
- `openWorldHint:false` OpenAI review metadata fix is preserved.
- Failed processing does not consume completed-job quota.

## Final onboarding + source-scope hardening

- Added screenshot-based Claude setup guide using current tested UI.
- Recommended OAuth path is DCR (`Register automatically`); no manual client ID/secret.
- Permission popup is explicitly optional because Claude session behavior can vary.
- Added troubleshooting for `Tools already loaded` only when Claude fails to call Link2AI.
- Clarified why `Read link content` may appear under write/delete tools: it creates an internal processing/quota job but never edits/deletes source links, chats, or files.
- Tool output now explicitly states V1 is spoken/caption-text context only and warns Claude not to invent visual-only relationships.
- `openWorldHint` corrected to `true` because the tool reaches public external URLs.
