# LTA — OpenAI review cases

Use the dedicated production reviewer account supplied privately in the OpenAI submission portal. No MFA, email confirmation, SMS confirmation, or private-network access may be required.

The ChatGPT distribution is intentionally limited to individual public Bluesky posts, public GitHub Issues / pull requests, and Hacker News items / discussions. Other LTA distributions may support additional source types, but those source types are not available through the ChatGPT distribution. Failed reads consume 0 processing units. Profiles, feeds, timelines, broad crawling, private/login-only content, and paywall/DRM bypass remain unsupported.

## Positive cases — exactly 5

### P1 — Bluesky post
**Prompt**
Use LTA to read this Bluesky post and summarize the post plus the main public replies: https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f

**Expected behavior**
- Invoke `read_public_link` for the exact Bluesky post.
- Return the post text and available public-thread context with exact source identity.
- If continuation is required, continue with `get_transcript_result`.
- Keep source completeness limitations explicit.

**Expected result structure**
A concise source-grounded summary of the post and available public replies.

**Fixture**
`https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f` — public Bluesky post used by the LTA reviewer demo.

### P2 — Hacker News discussion
**Prompt**
Read this Hacker News discussion with LTA and summarize the strongest disagreements and the evidence each side gives: https://news.ycombinator.com/item?id=37137448

**Expected behavior**
- Invoke `read_public_link` for the exact Hacker News item.
- Read the discussion returned through the Hacker News Firebase API path used by LTA.
- Follow `next_offset` while `continuation_required=true` if the delivered result spans multiple chunks.
- Do not treat a partial delivery as the complete source.

**Expected result structure**
A concise map of the main positions and the public comments supporting them.

**Fixture**
`https://news.ycombinator.com/item?id=37137448` — a compact Draw.io discussion with a clear disagreement about whether the project should be described as fully open source.

### P3 — Find inside a GitHub pull request
**Prompt**
Use LTA to read this pull request, find where maxHeadersCount is discussed, and summarize the relevant change: https://github.com/nodejs/node/pull/65472

**Expected behavior**
- Invoke `read_public_link` for the exact pull request.
- Use `find_in_link` on the processed result to locate the relevant discussion.
- Treat search as a locator rather than proof that omitted text does not exist.
- Attribute the summary to the pull request.

**Expected result structure**
A concise explanation of the maxHeadersCount-related change grounded in the pull request and its discussion.

**Fixture**
`https://github.com/nodejs/node/pull/65472` — a compact Node.js pull request for the maxHeadersCount documentation fix.

### P4 — Multi-source GitHub comparison
**Prompt**
Compare this Node.js issue with the pull request that fixed it. Explain the reported problem, what changed in the fix, and how reviewer feedback affected the final result. Attribute each point to its source: https://github.com/nodejs/node/issues/65470 https://github.com/nodejs/node/pull/65472

**Expected behavior**
- Invoke `read_public_links` so source identities remain separate.
- Preserve each source's own source/completeness/continuation state inside tool state; do not narrate internal IDs in the normal user-facing answer.
- Continue any source whose `continuation_required` value is true before making a claim that depends on omitted content.

**Expected result structure**
A comparison that clearly attributes the reported bug to the GitHub issue and the implemented/reviewed fix to the pull request.

**Fixture**
`https://github.com/nodejs/node/issues/65470` and `https://github.com/nodejs/node/pull/65472` — a compact issue/PR pair describing the same maxHeadersCount documentation bug and its fix.

### P5 — Usage balance
**Prompt**
How many LTA processing units do I have left?

**Expected behavior**
- Invoke `get_usage`.
- Read only the authenticated review account's plan and unit balance.
- Use `remaining_usage_units` as the authoritative remaining balance.
- Do not expose internal auth or billing secrets.

**Expected result structure**
Plan plus remaining processing units.

**Fixture**
Dedicated production reviewer account.

## Negative cases — exactly 3

### N1 — Broad profile/feed crawl
**Prompt**
Use LTA to crawl every post from this Bluesky profile and summarize the account: https://bsky.app/profile/bsky.app

**Expected behavior**
Do not perform broad crawling. Explain that the ChatGPT distribution of LTA reads supported exact public source URLs rather than profiles, feeds, timelines, or bulk collections.

**Why the plugin must not complete the requested operation**
Broad crawling is outside LTA's declared product scope and supported-source contract.

### N2 — User explicitly forbids external fetching
**Prompt**
Do not use LTA or any external tool. Just answer from what I pasted here. URL for context only: https://news.ycombinator.com/item?id=37137448

**Expected behavior**
Do not invoke LTA. Answer only from the supplied conversation content, or explain that the requested source-dependent answer cannot be verified without fetching.

**Why the plugin must not complete the requested operation**
The user's explicit instruction not to use external fetching must take precedence over LTA's fallback workflow.

### N3 — URL is incidental
**Prompt**
Save this link for later: https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f

**Expected behavior**
Do not invoke LTA merely because a supported URL appears in the conversation.

**Why the plugin must not complete the requested operation**
The request does not depend on reading or understanding the content behind the link.
