# Link2AI — OpenAI review cases

Use the dedicated production reviewer account supplied privately in the OpenAI submission portal. No MFA, email confirmation, SMS confirmation, or private-network access may be required.

## Positive cases — exactly 5

### P1 — YouTube source fallback
**Prompt**
Read this public YouTube source with Link2AI and summarize its main argument: <REVIEW_YOUTUBE_URL>

**Expected behavior**
- Invoke `read_public_link` for the exact URL.
- If the job is processing, continue with `get_transcript_result`.
- Follow `next_offset` while `continuation_required=true` if more context is needed.
- Preserve the exact source identity.
- Do not invent visual-only details.

**Expected result structure**
A concise summary grounded in `content_text`, with any relevant completeness limitation stated.

**Fixture**
Use a stable public YouTube URL verified in production immediately before submission.

### P2 — Long article continuation
**Prompt**
Read this article completely with Link2AI, then list the author's main claims and supporting evidence: <REVIEW_LONG_ARTICLE_URL>

**Expected behavior**
- Invoke `read_public_link`.
- Continue through all required result pages using `get_transcript_result`.
- Do not describe the source as fully read while `continuation_required=true`.

**Expected result structure**
Claims and supporting evidence based on the complete delivered source text.

**Fixture**
Use a stable public article whose extracted text exceeds one Link2AI MCP delivery chunk.

### P3 — GitHub pull request discussion
**Prompt**
Read this pull request with Link2AI and summarize the main implementation change, reviewer concerns, and unresolved discussion: <REVIEW_GITHUB_PR_URL>

**Expected behavior**
- Invoke `read_public_link` for the exact PR.
- Include available PR body, diff, issue comments, reviews, and inline review comments returned by Link2AI.
- Preserve file/line context when present.

**Expected result structure**
A structured PR summary with implementation, review concerns, and unresolved points.

**Fixture**
Use a stable public GitHub PR containing review discussion and at least one inline review comment.

### P4 — Public PDF
**Prompt**
Read this PDF with Link2AI and summarize each major section, then give me the document's conclusion: <REVIEW_PDF_URL>

**Expected behavior**
- Invoke `read_public_link`.
- Continue through long-result pagination if needed.
- Preserve page-related completeness metadata.
- If the PDF lacks a readable text layer, return a clear failure instead of fabricating text.

**Expected result structure**
Section-by-section summary plus conclusion, grounded in the PDF text.

**Fixture**
Use a stable public text-layer PDF verified in production.

### P5 — Usage balance
**Prompt**
How many Link2AI processing units do I have left?

**Expected behavior**
- Invoke `get_usage`.
- Read only the authenticated review account's plan and unit balance.
- Do not expose internal auth or billing secrets.

**Expected result structure**
Plan plus remaining processing units.

**Fixture**
Dedicated production reviewer account.

## Negative cases — exactly 3

### N1 — Login-gated/private source
**Scenario**
User provides a source that requires login or is private and asks Link2AI to read it.

**Expected behavior**
Return a clear unsupported/inaccessible failure. Do not fabricate source contents. Failed reads consume 0 processing units.

**Why the plugin must not complete the requested operation**
Link2AI only supports public content that its production retrieval layer can legitimately access.

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
