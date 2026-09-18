# Link2AI — OpenAI review demo video

OpenAI requires a demo video URL for final remote-MCP directory submission. This is a reviewer demo, not a marketing video.

## Recording target

Record one continuous desktop capture, approximately 2–4 minutes, showing the production ChatGPT-specific Link2AI workflow end to end.

## Required sequence

1. Show the Link2AI public website briefly.
2. In ChatGPT, show Link2AI already installed/connected through the review configuration using the production `/mcp/openai` endpoint.
3. Submit a stable public GitHub PR and ask ChatGPT to read it with Link2AI and summarize the implementation plus review discussion.
4. Show Link2AI OAuth/reviewer authentication if the review connection requires it.
5. Show the tool call returning the exact GitHub source identity and source text.
6. Submit a stable public Hacker News discussion and ask for the strongest disagreements. If the source requires continuation, show at least one `get_transcript_result` continuation call.
7. Ask "How many Link2AI processing units do I have left?" and show `get_usage`.
8. Submit one source intentionally blocked on the ChatGPT distribution, such as a YouTube URL, and show the explicit blocked result with no fabricated content.
9. End on the working ChatGPT answer for one of the supported sources.

## Recording rules

- Use production, not localhost or a staging endpoint.
- Use the ChatGPT-specific production MCP URL, not the general `/mcp` endpoint.
- Do not use the previous Instagram Reel demo for formal submission.
- Do not show passwords, tokens, client secrets, cookies, Railway variables, or internal admin pages.
- Do not edit the video to imply a successful action that did not occur.
- Keep the source URLs visible enough for the reviewer to identify what was tested.
- Upload the final recording to a reviewer-accessible HTTPS URL and paste that URL into the OpenAI submission portal.
