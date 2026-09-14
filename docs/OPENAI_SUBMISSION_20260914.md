# Link2AI — OpenAI Plugin Submission Pack
Date: 2026-09-14

## Product identity
**Name:** Link2AI

**Tagline:** Paste a link. Your AI can read it.

**Short description:** Link2AI lets ChatGPT understand supported public links it cannot reliably read on its own.

**Long description:**  
Link2AI gives ChatGPT access to AI-readable context behind supported public links. Connect once, then paste a supported YouTube, YouTube Shorts, TikTok, or Instagram Reel link and ask a normal question. Link2AI supplies the missing transcript context only when the answer actually depends on that link; ChatGPT remains the interface and does the reasoning.

Link2AI does not bypass private accounts, authentication, paywalls, DRM, geographic restrictions, or deleted/restricted content.

## Production URLs
- Website: `https://api-production-0383e.up.railway.app/`
- MCP: `https://api-production-0383e.up.railway.app/mcp`
- Privacy: `https://api-production-0383e.up.railway.app/privacy`
- Terms: `https://api-production-0383e.up.railway.app/terms`
- Support: `https://api-production-0383e.up.railway.app/support`
- Status: `https://api-production-0383e.up.railway.app/status`
- Domain challenge: `https://api-production-0383e.up.railway.app/.well-known/openai-apps-challenge`

## Listing fields
- Category: `Productivity` (use the closest Utilities/Productivity option shown by the portal)
- Availability: `Global / all Plugin Directory-supported regions`
- MCP deployment: `Universal`
- Authentication: `OAuth 2.1 / authorization code + PKCE`
- Custom UI: `None` (MCP-only plugin)
- Component CSP / UI fetch domains: `None` because Link2AI ships no plugin component UI
- Listing logo: `assets/Link2AI_Logo_1024.png`

## Starter prompts
1. Read this link and tell me what it is about: `<link>`
2. Summarize the main points from this link: `<link>`
3. Is the claim in this link accurate? `<link>`
4. What does the speaker say about `<topic>` in this link?
5. Compare what this link says with what we already know: `<link>`

## Reviewer credentials
Configure these only in the production environment:
- `REVIEWER_EMAIL`
- `REVIEWER_PASSWORD`

The reviewer account bypasses email OTP only for the exact configured credentials and receives a test-only Pro entitlement so review is not blocked by the public free-trial limit. Use a dedicated email identifier and a unique 16+ character password. Do not commit either value.

## Domain verification
When the OpenAI submission portal supplies a challenge token:
1. Set `OPENAI_APPS_CHALLENGE` in the API production environment.
2. Redeploy the API.
3. Confirm `/.well-known/openai-apps-challenge` returns the token as the entire plain-text response body.
4. Complete domain verification in the submission portal.

## MCP tools and annotations

### `get_video_transcript`
Purpose: Start/reuse processing for a supported public link when the user's request depends on the content behind it.

Annotations:
- `readOnlyHint: false` — may enqueue work/reserve quota.
- `destructiveHint: false` — no destructive write.
- `idempotentHint: false` — repeated calls are not guaranteed to have zero additional effect across job/cache state changes.
- `openWorldHint: true` — resolves/fetches content from public third-party platforms.

### `get_transcript_result`
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

### `get_usage`
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

## Positive test cases

### Positive 1 — captioned supported link
**Prompt:** `Read this YouTube link and tell me the main point: <fixture URL>`

**Expected:**
- ChatGPT calls Link2AI because the answer depends on the link.
- Existing captions are preferred when available.
- Link2AI returns transcript context without internal provider/debug secrets.
- ChatGPT answers the user.

### Positive 2 — no-caption supported link
**Prompt:** `What is being said in this link? <fixture URL>`

**Expected:**
- Link2AI resolves the supported public link.
- ASR fallback is used when captions are unavailable.
- The result is returned to ChatGPT.

### Positive 3 — asynchronous/long-running processing
**Prompt:** `Give me the key points from this supported public link: <fixture URL>`

**Expected:**
- `get_video_transcript` may return `processing` + `job_id`.
- ChatGPT follows with `get_transcript_result`.
- The user is not asked to paste the URL again.

### Positive 4 — usage
**Prompt:** `How much Link2AI usage do I have left?`

**Expected:**
- `get_usage` is called.
- Current plan and remaining link/content quota are returned accurately.

### Positive 5 — cached content
**Prompt:** `Read this link again and answer a different question: <same fixture URL>`

**Expected:**
- Valid cached transcript context may be reused.
- The tool remains correct and does not expose internal cache details unnecessarily.

## Negative test cases

### Negative 1 — private/unsupported content
**Prompt:** `Read this private or login-only link: <fixture URL>`

**Expected:**
- Link2AI does not attempt to bypass access controls.
- It returns a clear unsupported/private-content error.
- Failed processing does not consume completed-job quota.

### Negative 2 — explicit opt-out
**Prompt:** `Do not use Link2AI. Just tell me what you can infer from this URL: <supported URL>`

**Expected:**
- Link2AI is not called.

### Negative 3 — URL present but content not needed
**Prompt:** `Save this link for later: <supported URL>`

**Expected:**
- Link2AI is not called merely because a URL appears.

## Release notes
Initial Link2AI public plugin submission.

Link2AI is an MCP-backed access layer for supported public YouTube, TikTok, and Instagram links. It returns AI-readable transcript context to ChatGPT only when the user's request depends on the content behind the link.

The initial release includes:
- OAuth account connection
- caption-first extraction with ASR fallback
- asynchronous job polling
- transcript caching
- usage/quota reporting
- one-time free trial: 3 successful links or 10 minutes of processed content, whichever comes first
- clear handling of private, unsupported, removed, and restricted content

## Before pressing Submit for Review
- [ ] OpenAI developer/business identity verified
- [ ] Apps Management permission allows write/submission
- [ ] Production MCP URL reachable
- [ ] Privacy / Terms / Support published
- [ ] Listing logo uploaded
- [ ] Reviewer credentials configured and tested without OTP/MFA/email confirmation
- [ ] Domain challenge configured and verified
- [ ] Tool scan passes
- [ ] Tool annotations match production behavior
- [ ] Five positive cases entered
- [ ] Three negative cases entered
- [ ] Starter prompts entered
- [ ] Release notes entered
- [ ] Production smoke test passes after this hotfix deploy


## Founding beta auth

Public users can start a free browser-bound trial without email. This avoids making a verified outbound-email domain a launch blocker. The OpenAI reviewer uses the dedicated reviewer username/password path, which requires no MFA, SMS, or email confirmation.
