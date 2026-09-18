# Link2AI — OpenAI review demo video

OpenAI requires a demo video URL for final remote-MCP directory submission. This is a reviewer demo, not a marketing video.

## Recording target

Record one continuous desktop capture, approximately 2–4 minutes, showing the production plugin workflow end to end.

## Required sequence

1. Show the Link2AI public website briefly.
2. In ChatGPT, show Link2AI already installed/connected through the review configuration.
3. Submit a stable public YouTube URL and ask ChatGPT to read it with Link2AI and summarize the source.
4. Show Link2AI OAuth/reviewer authentication if the review connection requires it.
5. Show the tool call returning the exact source identity and source text.
6. If the source requires continuation, show at least one `get_transcript_result` continuation call.
7. Show a public GitHub PR request and demonstrate that Link2AI returns PR discussion context.
8. Ask "How many Link2AI processing units do I have left?" and show `get_usage`.
9. Show one unsupported/private-source failure so the reviewer can see Link2AI does not fabricate content.
10. End on the working ChatGPT answer.

## Recording rules

- Use production, not localhost or a staging endpoint.
- Do not show passwords, tokens, client secrets, cookies, Railway variables, or internal admin pages.
- Do not edit the video to imply a successful action that did not occur.
- Keep the source URLs visible enough for the reviewer to identify what was tested.
- Upload the final recording to a reviewer-accessible HTTPS URL and paste that URL into the OpenAI submission portal.
