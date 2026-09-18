# Link2AI — ChatGPT / Codex public plugin submission

## Submission type

**Contains MCP** with an optional bundled skill.

Production MCP URL:

`https://api-production-0383e.up.railway.app/mcp`

MCP URL type: **Universal**.

## Public listing

**Plugin name:** Link2AI

**Short description:** Read public links when the original source is not reliably available to the AI.

**Long description:** Link2AI retrieves AI-readable source context from supported public videos, social posts, developer discussions, webpages, and text-layer PDFs when the AI cannot reliably access the original source itself. It preserves source identity, reports incomplete upstream results honestly, and paginates long results without treating delivery chunk size as a source-size limit.

**Developer identity:** Use the verified publisher identity selected in the OpenAI submission portal. Do not claim a publisher name that has not completed the corresponding individual or business verification.

**Website:** https://api-production-0383e.up.railway.app/

**Support:** https://api-production-0383e.up.railway.app/support

**Privacy:** https://api-production-0383e.up.railway.app/privacy

**Terms:** https://api-production-0383e.up.railway.app/terms

## Authentication

OAuth 2.1 / authorization-code + PKCE.

Required resource scope: `link2ai:read`.

The production server exposes protected-resource metadata and authorization-server metadata and supports dynamic client registration.

Normal users sign in to Link2AI with Google. OpenAI reviewers use the dedicated reviewer email/password flow exposed on the Link2AI sign-in page. Reviewer credentials are configured only in production environment variables and must be supplied privately in the submission portal. The reviewer flow must not require MFA or any out-of-band verification.

## OpenAI domain challenge

The production route is:

`/.well-known/openai-apps-challenge`

Do not set a placeholder challenge in production. When the OpenAI submission portal issues the challenge token, set `OPENAI_APPS_CHALLENGE` in the production API service to that exact value and verify the route returns it verbatim before submission.

## Tool review notes

### read_public_link
Starts or reuses a Link2AI source-reading job for an exact supported public URL.

- readOnlyHint: false — it can create a job and consume Link2AI processing units.
- destructiveHint: false.
- openWorldHint: true — it accesses a user-specified public internet source.
- OAuth required: `link2ai:read`.

### get_video_transcript
Compatibility alias for existing Link2AI clients. Same side-effect and security classification as `read_public_link`.

### get_transcript_result
Reads the current state/content of an existing user-owned Link2AI job.

- readOnlyHint: true.
- destructiveHint: false.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

### get_usage
Reads the connected user's Link2AI plan and processing-unit balance.

- readOnlyHint: true.
- destructiveHint: false.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

## Suggested review prompts

1. **Supported video fallback**
   - Provide a public YouTube URL that is accessible in production.
   - Ask: "Read this source with Link2AI and summarize its main argument."
   - Expected: `read_public_link` returns or starts the exact source job; if processing, the client continues with `get_transcript_result`.

2. **Long-source continuation**
   - Use a supported source longer than one MCP delivery chunk.
   - Expected: `continuation_required=true`, then repeated `get_transcript_result(next_offset)` calls until delivery is complete.

3. **GitHub pull request**
   - Provide a public GitHub PR with discussion/review comments.
   - Ask for a summary of the disagreement.
   - Expected: source identity is the exact PR and the response includes available public discussion context.

4. **Unsupported/private source**
   - Provide a login-gated or unsupported URL.
   - Expected: clear failure; no fabricated source contents; failed/unsupported reads consume 0 Link2AI processing units.

5. **Usage**
   - Ask: "How many Link2AI processing units do I have left?"
   - Expected: `get_usage` returns the connected review account's plan and remaining units.

## Pre-submission gates

- GitHub CI green on the exact production commit.
- Railway API and worker both SUCCESS on the exact production commit.
- MCP tool scan exposes security schemes, output schemas, and accurate annotations.
- Reviewer login works from outside the developer's own network without MFA.
- OpenAI challenge token is configured and externally readable.
- Privacy / Terms / Support pages return 200.
- At least one real production E2E is recorded for each currently advertised source category before claiming that category in review material.
- Reddit remains unadvertised until production has approved Reddit OAuth Data API credentials.


## Final directory-only requirements

OpenAI's final remote-MCP directory submission also requires:
- a square `interface.logo` asset;
- a square `interface.composerIcon` asset;
- exactly five positive and three negative review cases (see `REVIEW_CASES.md`);
- a reviewer-accessible demo video URL (see `DEMO_VIDEO.md`);
- release notes (see `RELEASE_NOTES.md`);
- a category and availability countries/regions selected in the portal;
- the public developer identity/listing metadata to match the identity actually verified in OpenAI Platform.

### Current blockers before final submit
1. Publisher verification is still in review.
2. The repository currently has no Link2AI logo/composer icon asset. Do not invent or submit placeholder branding without approval.
3. The demo video cannot be recorded until the ChatGPT review connection/submission draft is available.
4. The domain challenge token is issued by the submission portal and must be configured only after the portal provides it.
