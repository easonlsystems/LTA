# Link2AI — OpenAI review cases

Use the dedicated production reviewer account supplied privately in the OpenAI submission portal. No MFA, email confirmation, SMS confirmation, or private-network access may be required.

The ChatGPT distribution is intentionally limited to public Bluesky posts, public GitHub Issues / pull requests, and public Hacker News discussions. Other Link2AI sources are blocked on this distribution unless a separately authorized retrieval path is added later.

## Positive cases — exactly 5

### P1 — GitHub pull request discussion
**Prompt**
Read this pull request with Link2AI and summarize the main implementation change, reviewer concerns, and unresolved discussion: <REVIEW_GITHUB_PR_URL>

**Expected behavior**
- Invoke `read_public_link` for the exact PR.
- Include available PR body, diff, issue comments, reviews, and inline review comments returned by Link2AI.
- Preserve file/line context when present.
- If more than one MCP delivery chunk is needed, continue with `get_transcript_result`.

**Expected result structure**
A structured PR summary with implementation, review concerns, and unresolved points.

**Fixture**
Use a stable public GitHub PR containing review discussion and at least one inline review comment.

### P2 — Hacker News discussion
**Prompt**
Read this Hacker News discussion with Link2AI and summarize the strongest disagreements and the evidence each side gives: <REVIEW_HN_URL>

**Expected behavior**
- Invoke `read_public_link` for the exact Hacker News item.
- Read the discussion returned through the official Hacker News Firebase API path used by Link2AI.
- Follow `next_offset` while `continuation_required=true` if the delivered result spans multiple chunks.
- Do not treat a partial delivery as the complete source.

**Expected result structure**
A concise map of the main positions and the public comments supporting them.

**Fixture**
Use a stable public Hacker News item with a non-trivial comment tree.

### P3 — Bluesky post and replies
**Prompt**
Read this Bluesky post with Link2AI and summarize the main claim plus the most relevant public replies: <REVIEW_BLUESKY_URL>

**Expected behavior**
- Invoke `read_public_link` for the exact public Bluesky post.
- Preserve the exact source identity.
- Use only text returned from the public AT Protocol API path.
- Do not invent image-only or visual details.

**Expected result structure**
The post's main claim followed by the relevant public reply context.

**Fixture**
Use a stable public Bluesky post with at least one public reply.

### P4 — Multi-source comparison
**Prompt**
Compare these two public sources with Link2AI and tell me where they agree and disagree: <REVIEW_GITHUB_ISSUE_URL> <REVIEW_HN_URL>

**Expected behavior**
- Invoke `read_public_links` so source identities remain separate.
- Preserve each source's own `source_key`, `job_id`, completeness state, and continuation state.
- Continue any source whose `continuation_required` value is true before making a claim that depends on omitted content.

**Expected result structure**
A comparison that clearly attributes claims to the GitHub and Hacker News sources separately.

**Fixture**
Use one stable public GitHub Issue and one stable public Hacker News discussion.

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
**Scenario**
User asks Link2AI to read a YouTube, Instagram, TikTok, X, Reddit, arbitrary webpage, or arbitrary PDF URL.

**Expected behavior**
Return a clear `PLATFORM_BLOCKED` result before retrieval, cache reuse, job creation, or quota consumption. Do not silently fall back to another Link2AI retrieval route.

**Why the plugin must not complete the requested operation**
Those source categories are intentionally unavailable through the ChatGPT distribution unless a separately authorized retrieval path is added later.

### N2 — Broad profile/feed crawl
**Scenario**
User asks: "Use Link2AI to crawl every post from this user's profile/feed."

**Expected behavior**
Do not perform broad crawling. Explain that Link2AI reads supported exact public source URLs rather than profiles, feeds, timelines, or bulk collections.

**Why the plugin must not complete the requested operation**
Broad crawling is outside Link2AI's declared product scope and supported-source contract.

### N3 — User explicitly forbids external fetching
**Scenario**
User provides a URL but says: "Do not use Link2AI or any external tool. Just answer from what I pasted here."

**Expected behavior**
Do not invoke Link2AI. Answer only from the supplied conversation content, or explain that the requested source-dependent answer cannot be verified without fetching.

**Why the plugin must not complete the requested operation**
The user's explicit instruction not to use external fetching must take precedence over Link2AI's fallback workflow.
