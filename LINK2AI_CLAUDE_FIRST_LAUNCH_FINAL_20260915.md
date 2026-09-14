# Link2AI — Claude-first launch final

Date: 2026-09-15

## Scope frozen for first public beta

This cumulative release is the Claude-first V1 launch candidate. It includes all prior launch hardening, the Instagram missing-duration recovery, the Claude-first landing/onboarding redesign, and the final onboarding/source-scope hardening below.

## Final changes

- `/connect` is now a screenshot-based setup guide built around the current Claude UI tested during dogfooding.
- Preferred OAuth setup: **Sign in now → Register automatically (DCR) → Add**. Users should not need a manually issued client ID or secret.
- The permission popup is treated as optional because Claude session behavior can vary; users are not told to hunt for a popup that may not appear.
- A troubleshooting-only step explains `Tools already loaded` if Claude fails to call Link2AI.
- The setup guide explains why `Read link content` can appear under Claude's write/delete category: Link2AI creates an internal processing job/reserves quota, but never edits/deletes the source link, Claude chats, or user files.
- Current dogfood screenshots are bundled with the app so the guide does not depend on stale third-party web screenshots.
- `Read link content` now declares `openWorldHint: true`, matching MCP semantics because it reaches public external URLs.
- Tool output now explicitly identifies its scope as `spoken_and_caption_text` and tells the host not to invent visual-only relationships. This mitigates the observed case where a transcript-only Reel was incorrectly reconstructed into a table.
- V1 product copy explicitly states that visual-only text/layout/gestures/diagrams may be unavailable.

## Validation performed in this workspace

- `tsc -p tsconfig.check.json --pretty false` — PASS
- `tsc -p tsconfig.pure.json --pretty false` — PASS
- `node test/pure.mjs` — PASS

A full `npm test` could not be completed in this workspace because the local dependency install is unavailable/incomplete. Railway's normal build remains the authoritative full compile/deploy gate after push.

## Launch boundary

V1 reads spoken/caption content behind supported public YouTube, YouTube Shorts, Instagram Reel, and TikTok links. It is not a full visual-video understanding system. Visual-only information can be missing.
