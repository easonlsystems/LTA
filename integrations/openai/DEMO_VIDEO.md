# Link2AI — OpenAI review demo video

OpenAI requires a demo video URL for final remote-MCP directory submission. This is a reviewer demo, not a marketing video.

## Recording target

Record one continuous desktop capture, approximately 2–4 minutes, showing the production ChatGPT-specific Link2AI workflow end to end.

## Required sequence

1. Show the Link2AI public website briefly.
2. In ChatGPT, show Link2AI already installed/connected through the review configuration using the production `/mcp/openai` endpoint.
3. Paste `https://github.com/nodejs/node/pull/65472` and ask: “Read this pull request with Link2AI and summarize the change, the main reviewer concern, and how it was resolved.”
4. Show Link2AI OAuth/reviewer authentication if the review connection requires it.
5. Show the tool call returning the exact GitHub source identity and source text.
6. Paste `https://news.ycombinator.com/item?id=37137448` and ask: “Read this Hacker News discussion with Link2AI and summarize the strongest disagreements and the evidence each side gives.” If the source requires continuation, show at least one `get_transcript_result` continuation call.
7. Ask "How many Link2AI processing units do I have left?" and show `get_usage`.
8. Paste `https://www.youtube.com/watch?v=M7lc1UVf-VE` and ask Link2AI to summarize it. Show the explicit `PLATFORM_BLOCKED` result with no fabricated content and no processing-unit charge.
9. End on the working ChatGPT answer for one of the supported sources.

## Recording rules

- Use production, not localhost or a staging endpoint.
- Use the ChatGPT-specific production MCP URL, not the general `/mcp` endpoint.
- Do not use the previous Instagram Reel demo for formal submission.
- Do not show passwords, tokens, client secrets, cookies, Railway variables, or internal admin pages.
- Do not edit the video to imply a successful action that did not occur.
- Keep the source URLs visible enough for the reviewer to identify what was tested.
- Upload the final recording to a reviewer-accessible HTTPS URL and paste that URL into the OpenAI submission portal.


## Exact review fixtures

- GitHub PR: https://github.com/nodejs/node/pull/65472
- Hacker News: https://news.ycombinator.com/item?id=37137448
- Bluesky (optional extra positive demo): https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f
- Blocked YouTube negative: https://www.youtube.com/watch?v=M7lc1UVf-VE

Use these exact URLs in the recording so the demo matches the submitted review cases.
