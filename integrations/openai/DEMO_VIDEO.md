# LTA — OpenAI review demo video

OpenAI requires a reviewer-accessible demo video URL for final remote-MCP directory submission. This is a reviewer demo, not a marketing video.

## Recording target

Record one continuous desktop capture, approximately 2–4 minutes, showing the production ChatGPT-specific `/mcp/openai` workflow end to end.

## Required sequence

1. Show the LTA public website briefly and state that the broader LTA product can read supported public links in other distributions.
2. In ChatGPT, show LTA installed/connected through the production `/mcp/openai` review configuration.
3. Ask: `Does LTA recognize this kind of link? https://www.instagram.com/reel/DdNnHPip4RD/`
4. Show `check_link_support` returning compatibility only, including `directory_content_access=false` and `network_request_made=false`.
5. Ask: `What source types does LTA currently support?` and show `get_supported_sources`.
6. Ask: `About how many LTA processing units would a 125-second video need?` and show `estimate_processing_units` returning 3.
7. Ask: `Estimate the LTA processing units for 25,000 characters of text.` and show `estimate_processing_units` returning 3.
8. Ask: `How many LTA processing units do I have left?` and show `get_usage`.
9. Ask: `Use LTA to read and summarize this YouTube video: https://www.youtube.com/watch?v=M7lc1UVf-VE` and show that the directory plugin does not claim to read or retrieve the video contents.

## Recording rules

- Use production, not localhost or staging.
- Use the ChatGPT-specific production MCP URL, not the general `/mcp` endpoint.
- The Scan must expose exactly four tools: `check_link_support`, `get_supported_sources`, `estimate_processing_units`, and `get_usage`.
- The Scan must import only the `use-lta-account-and-source-planning` Skill.
- Do not show passwords, tokens, client secrets, cookies, Railway variables, or internal admin pages.
- Do not edit the video to imply a capability that did not occur.
- Do not show any result that claims the public-directory plugin read third-party source contents.
- Do not expose server logs, OAuth diagnostics, database details, or raw internal errors.
- Upload the final recording to a reviewer-accessible HTTPS URL and paste that URL into the OpenAI submission portal.

## Review fixtures

- Compatibility-only URL: https://www.instagram.com/reel/DdNnHPip4RD/
- Negative content-read URL: https://www.youtube.com/watch?v=M7lc1UVf-VE
- Video estimate: 125 seconds → 3 processing units
- Text estimate: 25,000 characters → 3 processing units

The external URLs are user-provided strings used only to demonstrate local compatibility parsing or a refusal boundary. The submitted MCP must not contact those sites during these steps.
