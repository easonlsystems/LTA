# LTA — OpenAI reviewer demo video

Record one continuous desktop capture against **production**, not localhost, after the exact submission commit is live on both API and worker and the production public certification passes.

## Before recording
- Use the dedicated reviewer account.
- Do not show passwords, tokens, client secrets, OAuth codes, internal IDs, server logs, Railway, GitHub Actions, or database/admin pages.
- Confirm ChatGPT is connected to `https://api-production-0383e.up.railway.app/mcp/openai`.
- Confirm the current Scan imports the six-tool OpenAI surface and the `read-public-links-with-lta` Skill.
- Confirm the ChatGPT source description says GitHub Issue/PR reads require a rights-eligible `CC0-1.0`, `0BSD`, or `Unlicense` repository license.

## Recording flow — target 2–4 minutes

1. Show the LTA public landing page briefly so the product identity and support/privacy links are visible.

2. In ChatGPT, use:
   `https://github.com/gnembon/scarpet/issues/408`
   Ask LTA to explain the keepalive bug, reproduction steps, and expected behavior.
   Show the successful source-grounded answer and the returned `source_license_spdx` evidence.

3. Open:
   `https://github.com/gnembon/scarpet/pull/422`
   Ask for the proposed fix and the main reviewer concerns.

4. On the same pull request, ask LTA to find where `schedule(0, ...)` is discussed and explain why the reviewer preferred it. This demonstrates `find_in_link` without exposing internal job IDs.

5. Ask LTA to compare:
   - `https://github.com/gnembon/scarpet/issues/408`
   - `https://github.com/gnembon/scarpet/pull/422`
   Show clear source attribution between the report and the proposed/reviewed fix.

6. Ask: `How many LTA processing units do I have left?`
   Show the normal `get_usage` response without any purchase/checkout prompt.

7. Optional short negative proof if recording time permits:
   try `https://github.com/nodejs/node/issues/65470` and show that the ChatGPT distribution fails closed because its repository license is not in the rights allowlist and charges 0 units.

End on a successful licensed-source answer. Do not include unrelated admin or infrastructure surfaces.
