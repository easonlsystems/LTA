# LTA — OpenAI review demo video

OpenAI requires a demo video URL for final remote-MCP directory submission. This is a reviewer demo, not a marketing video.

## Recording target

Record one continuous desktop capture, approximately 2–4 minutes, showing the production ChatGPT-specific LTA workflow end to end.

## Required sequence

1. Show the LTA public website briefly.
2. In ChatGPT, show LTA already installed/connected through the review configuration using the production `/mcp/openai` endpoint.
3. Paste `https://www.instagram.com/reel/DdNnHPip4RD/` and ask: “Use LTA to read this Instagram Reel and summarize the main points.”
4. Show LTA OAuth/reviewer authentication if the review connection requires it.
5. Show the tool call returning the exact Instagram source identity and transcript/source text. Do not invent visual-only details.
6. Paste `https://www.youtube.com/watch?v=M7lc1UVf-VE` and ask: “Use LTA to read this YouTube video and summarize what it explains.” If processing is asynchronous, show `get_transcript_result` continuing the job.
7. Paste `https://github.com/nodejs/node/pull/65472` and ask: “Read this pull request with LTA and summarize the change, the main reviewer concern, and how it was resolved.”
8. Ask “How many LTA processing units do I have left?” and show `get_usage`.
9. End on a successful LTA answer for one of the supported media sources.

## Recording rules

- Use production, not localhost or a staging endpoint.
- Use the ChatGPT-specific production MCP URL, not the general `/mcp` endpoint.
- Do not show passwords, tokens, client secrets, cookies, Railway variables, or internal admin pages.
- Do not edit the video to imply a successful action that did not occur.
- Keep the source URLs visible enough for the reviewer to identify what was tested.
- Do not expose server logs, OAuth diagnostics, provider/transport details, internal job ids, source keys, cache metadata, or raw error payloads in the user-facing answer.
- Upload the final recording to a reviewer-accessible HTTPS URL and paste that URL into the OpenAI submission portal.

## Exact review fixtures

- Instagram Reel: https://www.instagram.com/reel/DdNnHPip4RD/
- YouTube: https://www.youtube.com/watch?v=M7lc1UVf-VE
- GitHub PR: https://github.com/nodejs/node/pull/65472
- Hacker News (optional extra positive demo): https://news.ycombinator.com/item?id=37137448
- Bluesky (optional extra positive demo): https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f

Use these exact URLs in the recording so the demo matches the submitted review cases.
