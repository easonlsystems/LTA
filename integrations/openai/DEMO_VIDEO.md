# LTA — OpenAI review demo video

OpenAI requires a demo video URL for final remote-MCP directory submission. This is a reviewer demo, not a marketing video.

## Recording target

Record one continuous desktop capture, approximately 2–4 minutes, showing the production ChatGPT-specific LTA workflow end to end.

## Required sequence

1. Show the LTA public website briefly.
2. In ChatGPT, show LTA already installed/connected through the review configuration using the production `/mcp/openai` endpoint.
3. Paste `https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f` and ask: “Use LTA to read this Bluesky post and summarize the post plus the main public replies.”
4. Show LTA OAuth/reviewer authentication if the review connection requires it.
5. Show the tool call returning the exact Bluesky source identity and source text.
6. Paste `https://news.ycombinator.com/item?id=37137448` and ask: “Read this Hacker News discussion with LTA and summarize the strongest disagreements and the evidence each side gives.” If continuation is required, show `get_transcript_result` continuing the result.
7. Paste `https://github.com/nodejs/node/pull/65472` and ask: “Use LTA to read this pull request, find where maxHeadersCount is discussed, and summarize the relevant change.” Show `find_in_link` when it is used.
8. Ask “How many LTA processing units do I have left?” and show `get_usage`.
9. End on a successful LTA answer for one of the supported ChatGPT sources.

## Recording rules

- Use production, not localhost or a staging endpoint.
- Use the ChatGPT-specific production MCP URL, not the general `/mcp` endpoint.
- Do not show passwords, tokens, client secrets, cookies, Railway variables, or internal admin pages.
- Do not edit the video to imply a successful action that did not occur.
- Keep the source URLs visible enough for the reviewer to identify what was tested.
- Do not expose server logs, OAuth diagnostics, provider/transport details, internal job ids, source keys, cache metadata, or raw error payloads in the user-facing answer.
- Upload the final recording to a reviewer-accessible HTTPS URL and paste that URL into the OpenAI submission portal.

## Exact review fixtures

- Bluesky: https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f
- Hacker News: https://news.ycombinator.com/item?id=37137448
- GitHub PR: https://github.com/nodejs/node/pull/65472
- GitHub issue: https://github.com/nodejs/node/issues/65470

Use these exact URLs in the recording so the demo matches the submitted review cases.
