# Link2AI — OpenAI review cases

Use the dedicated production reviewer account supplied privately in the OpenAI submission portal. No MFA, email confirmation, SMS confirmation, or private-network access may be required.

The ChatGPT distribution is intentionally limited to public Bluesky posts, public GitHub Issues / pull requests, and public Hacker News discussions. Other Link2AI sources are blocked on this distribution unless a separately authorized retrieval path is added later.

Failed reads consume 0 processing units. Sources blocked by the ChatGPT distribution are rejected before retrieval or quota consumption.

## Positive cases — exactly 5

### P1 — GitHub pull request discussion
**Prompt**
Read this pull request with Link2AI and summarize the change, the main reviewer concern, and how it was resolved: https://github.com/nodejs/node/pull/65472

**Expected behavior**
- Invoke `read_public_link` for the exact PR.
- Include available PR body, diff, issue comments, reviews, and inline review comments returned by Link2AI.
- Preserve file/line context when present.
- If more than one MCP delivery chunk is needed, continue with `get_transcript_result`.

**Expected result structure**
A concise PR summary covering the documentation change, the main reviewer concern, and how the author resolved it.

**Fixture**
`https://github.com/nodejs/node/pull/65472` — Small Node.js documentation fix with approvals, a concrete reviewer concern, a changes-requested review, a follow-up fix, and final approval.

### P2 — Hacker News discussion
**Prompt**
Read this Hacker News discussion with Link2AI and summarize the strongest disagreements and the evidence each side gives: https://news.ycombinator.com/item?id=37137448

**Expected behavior**
- Invoke `read_public_link` for the exact Hacker News item.
- Read the discussion returned through the official Hacker News Firebase API path used by Link2AI.
- Follow `next_offset` while `continuation_required=true` if the delivered result spans multiple chunks.
- Do not treat a partial delivery as the complete source.

**Expected result structure**
A concise map of the main positions and the public comments supporting them.

**Fixture**
`https://news.ycombinator.com/item?id=37137448` — a compact Draw.io discussion with a clear disagreement about whether the project should be described as fully open source.

### P3 — Bluesky post and replies
**Prompt**
Read this Bluesky post with Link2AI and summarize the announcement: https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f

**Expected behavior**
- Invoke `read_public_link` for the exact public Bluesky post.
- Preserve the exact source identity.
- Use only text returned from the public AT Protocol API path.
- Do not invent image-only or visual details.

**Expected result structure**
A concise summary of the exact public Bluesky announcement, without inventing visual-only details.

**Fixture**
`https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f` — a short official Bluesky product-tip announcement suitable for deterministic exact-post reading.

### P4 — Multi-source comparison
**Prompt**
Compare this Node.js issue with the pull request that fixed it. Explain the reported problem, what changed in the fix, and how reviewer feedback affected the final result. Attribute each point to its source: https://github.com/nodejs/node/issues/65470 https://github.com/nodejs/node/pull/65472

**Expected behavior**
- Invoke `read_public_links` so source identities remain separate.
- Preserve each source's own `source_key`, `job_id`, completeness state, and continuation state.
- Continue any source whose `continuation_required` value is true before making a claim that depends on omitted content.

**Expected result structure**
A comparison that clearly attributes the reported bug to the GitHub issue and the implemented/reviewed fix to the pull request.

**Fixture**
`https://github.com/nodejs/node/issues/65470` and `https://github.com/nodejs/node/pull/65472` — a compact issue/PR pair describing the same maxHeadersCount documentation bug and its fix.

### P5 — Usage balance
**Prompt**
How many Link2AI processing units do I have left?

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

### N1 — Source blocked on the ChatGPT distribution
**Prompt**
Read this YouTube video with Link2AI and summarize it: https://www.youtube.com/watch?v=M7lc1UVf-VE

**Expected behavior**
The tool result should be `PLATFORM_BLOCKED` before retrieval, cache reuse, job creation, or quota consumption. The normal user-facing answer should translate that into plain language and must not expose server logs, OAuth diagnostics, provider details, or raw tool plumbing. Do not silently fall back to another Link2AI retrieval route.

**Why the plugin must not complete the requested operation**
Those source categories are intentionally unavailable through the ChatGPT distribution unless a separately authorized retrieval path is added later.

### N2 — Broad profile/feed crawl
**Prompt**
Use Link2AI to crawl every post from this Bluesky profile and summarize the account: https://bsky.app/profile/bsky.app

**Expected behavior**
Do not perform broad crawling. Explain that Link2AI reads supported exact public source URLs rather than profiles, feeds, timelines, or bulk collections.

**Why the plugin must not complete the requested operation**
Broad crawling is outside Link2AI's declared product scope and supported-source contract.

### N3 — User explicitly forbids external fetching
**Prompt**
Do not use Link2AI or any external tool. Just answer from what I pasted here. URL for context only: https://news.ycombinator.com/item?id=37137448

**Expected behavior**
Do not invoke Link2AI. Answer only from the supplied conversation content, or explain that the requested source-dependent answer cannot be verified without fetching.

**Why the plugin must not complete the requested operation**
The user's explicit instruction not to use external fetching must take precedence over Link2AI's fallback workflow.
