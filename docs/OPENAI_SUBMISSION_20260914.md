# Link2AI — OpenAI Plugin Submission Pack
Date: 2026-09-14
Status: final pre-ID pack; only identity-gated portal steps remain after this source revision is deployed.

## Directory metadata
- **Package name:** `link2ai`
- **Version:** `1.0.0`
- **Display name:** `Link2AI`
- **Short description:** `Make public links AI-readable`
- **Developer identity:** select the verified individual identity in the OpenAI Platform after Individual Verification completes.
- **Category:** `Productivity`
- **MCP URL type:** `Universal`
- **Custom UI:** None — MCP-only plugin.
- **Screenshots:** None — do not upload screenshots because Link2AI exposes no MCP UI output template.

### Long description
Link2AI makes supported public links readable by ChatGPT and other AI clients. Connect once, paste a supported YouTube, YouTube Shorts, TikTok, or Instagram Reel link, and ask a normal question. Link2AI supplies AI-readable transcript context only when the answer actually depends on the content behind the link; the host AI remains the interface and does the reasoning.

Link2AI prefers existing captions when available and can fall back to speech-to-text for supported public content when usable captions are unavailable. Longer jobs can continue asynchronously and be retrieved by job ID. Users can also ask for their current Link2AI usage and remaining quota.

Link2AI does not bypass private accounts, authentication, paywalls, DRM, geographic restrictions, deleted content, or other access controls.

## Capabilities
1. Read AI-readable transcript context from supported public YouTube, Shorts, TikTok, and Instagram Reel links.
2. Prefer available captions and use speech-to-text fallback when usable captions are unavailable.
3. Continue longer processing asynchronously and retrieve completed transcript results by job ID.
4. Report the connected user's Link2AI plan and remaining content quota.

## Public production URLs
- Website: `https://api-production-0383e.up.railway.app/`
- MCP server: `https://api-production-0383e.up.railway.app/mcp`
- Privacy: `https://api-production-0383e.up.railway.app/privacy`
- Terms: `https://api-production-0383e.up.railway.app/terms`
- Support: `https://api-production-0383e.up.railway.app/support`
- Status: `https://api-production-0383e.up.railway.app/status`
- Domain challenge: `https://api-production-0383e.up.railway.app/.well-known/openai-apps-challenge`
- Demo recording / reviewer walkthrough: `https://www.canva.com/d/Xfhvv7aOkzkMvHT`
- Listing logo: `assets/Link2AI_Logo_1024.png`

## Authentication and reviewer access
- OAuth authorization code flow with PKCE (`S256`).
- Production reviewer access uses the dedicated `REVIEWER_EMAIL` + `REVIEWER_PASSWORD` path.
- Reviewer access does not require email OTP, MFA, SMS, or private-network access.
- Reviewer login receives a test-only Pro plan so public trial limits do not block review.
- Do not commit reviewer credentials to the repository. Paste the private credentials supplied separately into the OpenAI portal.

## Starter prompts — exactly 3
1. `Read this link and summarize the main points: <link>`
2. `What does the speaker claim in this link, and is it accurate? <link>`
3. `What does this link say about <topic>? <link>`

## MCP tools and annotation justifications

### `get_video_transcript`
Purpose: start or reuse processing for a supported public link when the user's request depends on the content behind it.

Server annotations:
- `readOnlyHint: false`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: false`

Portal justifications:
- **readOnlyHint = false:** the tool can enqueue a job, reserve/finalize Link2AI quota, create cache/job records, and otherwise change Link2AI's internal state.
- **destructiveHint = false:** it does not delete, overwrite, revoke, send, purchase, publish, or cause an irreversible user-visible action.
- **openWorldHint = false:** it reads public third-party content but cannot write to or change publicly visible internet state; all writes are internal Link2AI job/quota/cache state.

### `get_transcript_result`
Server annotations:
- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: true`

Portal justifications:
- **readOnlyHint = true:** it only retrieves the authenticated user's existing Link2AI job result/chunks and does not create or modify state.
- **destructiveHint = false:** it has no irreversible side effect.
- **openWorldHint = false:** it only reads Link2AI's private/internal job state and does not affect public internet state.

### `get_usage`
Server annotations:
- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: true`

Portal justifications:
- **readOnlyHint = true:** it only reads plan, quota, period, and concurrency information for the authenticated user.
- **destructiveHint = false:** it has no irreversible side effect.
- **openWorldHint = false:** it only reads first-party/private Link2AI account state and does not affect public internet state.

## Reviewer fixtures
Primary public YouTube fixture:
`https://www.youtube.com/watch?v=9EJIH8kxTn8`

Secondary stable public YouTube fixture:
`https://www.youtube.com/watch?v=jNQXAC9IVRw`

Public YouTube Shorts fixture indexed by a current public webpage:
`https://www.youtube.com/shorts/BDV0hGGi2oU`

If a third-party fixture becomes unavailable before review, replace only that fixture URL with another public supported link; do not change the expected Link2AI behavior.

## Positive tests — exactly 5

### Positive 1 — read and summarize a public YouTube link
**Prompt:**
`Read this link and summarize the main points: https://www.youtube.com/watch?v=9EJIH8kxTn8`

**Expected tool/workflow behavior:**
- ChatGPT invokes `get_video_transcript` because the answer depends on the content behind the link.
- Link2AI resolves the public YouTube URL and returns completed transcript context, or returns `processing` with a `job_id` if work is still running.
- If `processing` is returned, ChatGPT follows with `get_transcript_result` using that `job_id` until the result is available.

**Expected result shape:**
A user-facing summary grounded in returned transcript context; tool result includes supported link metadata and transcript text/segments without auth secrets or debug payloads.

**Fixture/account:** reviewer OAuth credentials + the URL above.

### Positive 2 — read a second public YouTube link
**Prompt:**
`What does the speaker say in this link? https://www.youtube.com/watch?v=jNQXAC9IVRw`

**Expected tool/workflow behavior:**
- ChatGPT invokes `get_video_transcript`.
- Link2AI uses usable captions when available; if not, it may use the configured speech-to-text fallback.
- The host AI answers from the returned context rather than guessing from the URL/title alone.

**Expected result shape:**
A concise answer based on transcript content, with normal link metadata and transcript source information.

**Fixture/account:** reviewer OAuth credentials + the URL above.

### Positive 3 — YouTube Shorts URL
**Prompt:**
`Read this Short and tell me the key point: https://www.youtube.com/shorts/BDV0hGGi2oU`

**Expected tool/workflow behavior:**
- ChatGPT invokes `get_video_transcript`.
- Link2AI recognizes the YouTube Shorts URL as supported and processes it through the normal transcript pipeline.

**Expected result shape:**
A short content-grounded answer plus normal transcript metadata.

**Fixture/account:** reviewer OAuth credentials + the URL above.

### Positive 4 — usage query
**Prompt:**
`How much Link2AI usage do I have left?`

**Expected tool/workflow behavior:**
- ChatGPT invokes `get_usage`.
- No media-processing job is started.

**Expected result shape:**
Current plan, used/remaining content seconds, used/remaining successful links where applicable, current concurrency, and billing period information.

**Fixture/account:** reviewer OAuth credentials.

### Positive 5 — reuse the same link for a different question
**Prompt:**
`Using this same link, what best practices does it recommend? https://www.youtube.com/watch?v=9EJIH8kxTn8`

**Expected tool/workflow behavior:**
- ChatGPT invokes `get_video_transcript` because the question still depends on link content.
- Link2AI may reuse valid cached transcript context instead of reprocessing the same media.

**Expected result shape:**
A content-grounded answer to the new question; no unnecessary internal cache/debug details are exposed.

**Fixture/account:** reviewer OAuth credentials + the URL above.

## Negative tests — exactly 3

### Negative 1 — unsupported URL
**Prompt:**
`Read the content behind this link for me: https://example.com/`

**Expected behavior:**
Link2AI must not pretend the URL is a supported media link. If invoked, it returns a clear unsupported-link error and does not bypass or scrape arbitrary websites.

**Why it should not complete the action:**
Link2AI V1 is scoped to supported public YouTube, YouTube Shorts, TikTok, and Instagram Reel URLs.

### Negative 2 — explicit opt-out
**Prompt:**
`Do not use Link2AI. Just tell me what you can infer from this URL: https://www.youtube.com/watch?v=9EJIH8kxTn8`

**Expected behavior:**
Do not invoke any Link2AI tool. The host AI may state that it cannot reliably infer the content without reading it.

**Why it should not complete the action:**
The user explicitly opted out of Link2AI invocation.

### Negative 3 — URL is incidental
**Prompt:**
`Save this link for later: https://www.youtube.com/watch?v=9EJIH8kxTn8`

**Expected behavior:**
Do not invoke Link2AI merely because a URL is present.

**Why it should not complete the action:**
The request does not depend on reading or understanding the content behind the link.

## Release notes
Initial public submission of Link2AI, an MCP-backed plugin that makes supported public links AI-readable inside ChatGPT.

This release includes:
- OAuth authorization code + PKCE connection flow
- reviewer login with no OTP/MFA requirement
- public founding-beta browser trial
- YouTube, YouTube Shorts, TikTok, and Instagram Reel URL parsing
- caption-first transcript extraction with speech-to-text fallback
- asynchronous job polling through `get_transcript_result`
- transcript caching and quota reservation/finalization
- `get_usage` plan/quota reporting
- free trial of 3 successful links or 10 minutes of processed content, whichever comes first
- clear rejection of unsupported, private, login-only, deleted, geo-restricted, paid, or DRM-protected content
- published website, privacy, terms, support, status, logo, reviewer walkthrough, and domain-challenge endpoint

Reviewer credentials are provided separately. Link2AI has no custom MCP UI, so no screenshots are included.

## Only after Individual Verification
These steps cannot be completed before the OpenAI portal unlocks the submission:
1. Select the verified individual identity as Developer Identity.
2. Create/open the `With MCP` submission and choose `Universal`.
3. Enter `https://api-production-0383e.up.railway.app/mcp`.
4. When OpenAI generates the domain challenge token, set `OPENAI_APPS_CHALLENGE` in the API production environment and redeploy the API.
5. Verify the challenge endpoint returns exactly that token as plain text.
6. Enter the private reviewer credentials supplied separately.
7. Select **Scan Tools** and confirm the production metadata shows the annotation values above.
8. Enter the listing metadata, three starter prompts, exactly five positive tests, exactly three negative tests, demo-recording URL, release notes, availability, and attestations.
9. Submit for Review.

## Final pre-submit checks in the portal
- Identity selected and recognized in the same organization/project.
- Apps Management write access is available.
- Domain verification passes.
- Current production Scan Tools run passes.
- Reviewer OAuth works without MFA/SMS/email confirmation/private network.
- No screenshots are attached unless a later tool scan reports an actual UI output template.
- Annotation justifications match the scanned server metadata.
- Exactly 5 positive and 3 negative tests are present.
- At most 3 starter prompts are present.
