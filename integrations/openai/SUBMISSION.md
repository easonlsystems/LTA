# Link2AI — ChatGPT / Codex public plugin submission

## Submission type

**Contains MCP** with an optional bundled skill.

Production ChatGPT-specific MCP URL:

`https://api-production-0383e.up.railway.app/mcp/openai`

MCP URL type: **Universal**.

The general Link2AI `/mcp` endpoint is not the OpenAI submission endpoint.

## Public listing

**Plugin name:** Link2AI

**Short description:** Read supported public developer and discussion links when the original source is not reliably available to the AI.

**Long description:** Through its ChatGPT-specific distribution, Link2AI retrieves AI-readable source context from supported public Bluesky posts, GitHub Issues / pull requests, and Hacker News discussions. It preserves source identity, reports incomplete upstream results honestly, and paginates long results without treating delivery chunk size as a source-size limit.

**Developer identity:** Use the verified publisher identity selected in the OpenAI submission portal.

**Website:** https://api-production-0383e.up.railway.app/

**Support:** https://api-production-0383e.up.railway.app/support

**Privacy:** https://api-production-0383e.up.railway.app/privacy

**Terms:** https://api-production-0383e.up.railway.app/terms

## Authentication

OAuth 2.1 / authorization-code + PKCE.

Required resource scope: `link2ai:read`.

The ChatGPT distribution uses a dedicated OAuth resource audience for:

`https://api-production-0383e.up.railway.app/mcp/openai`

A token issued for the general Link2AI `/mcp` resource is not accepted by `/mcp/openai`, and a token issued for `/mcp/openai` is not accepted by the general endpoint.

Normal users sign in to Link2AI with Google. OpenAI reviewers use the dedicated reviewer email/password flow exposed on the Link2AI sign-in page. Reviewer credentials are configured only in production environment variables and must be supplied privately in the submission portal. The reviewer flow must not require MFA or any out-of-band verification.

## OpenAI domain challenge

The production route is:

`/.well-known/openai-apps-challenge`

Keep the submission-portal challenge token configured in production and verify the route returns it verbatim before submission.

## ChatGPT distribution source policy

Allowed on this release:
- Bluesky public posts / replies through the public AT Protocol API.
- GitHub public Issues / pull requests through the GitHub API.
- Hacker News public items / discussions through the official Hacker News Firebase API.

Blocked on this release:
- YouTube / Shorts
- Instagram
- TikTok
- X
- Reddit
- arbitrary webpages
- arbitrary PDFs

The server enforces this before retrieval, cache reuse, or job creation. Existing job ids from another Link2AI distribution are re-checked by platform before any result is returned, so cached content cannot be used to bypass this policy.

## Tool review notes

The ChatGPT-specific MCP endpoint exposes five tools.

### read_public_link
Starts or reuses a Link2AI source-reading job for one allowed exact public URL.

- readOnlyHint: false — it can create a job and consume Link2AI processing units.
- destructiveHint: false.
- openWorldHint: true.
- OAuth required: `link2ai:read`.

### read_public_links
Starts or reuses multiple allowed source-reading jobs for a comparison/synthesis request while keeping every source separate.

- readOnlyHint: false.
- destructiveHint: false.
- openWorldHint: true.
- OAuth required: `link2ai:read`.

### get_transcript_result
Reads the current state/content of an existing user-owned job after the ChatGPT distribution policy has been re-checked.

- readOnlyHint: true.
- destructiveHint: false.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

### find_in_link
Locates likely relevant text regions inside an existing permitted processed source job.

- readOnlyHint: true.
- destructiveHint: false.
- openWorldHint: false.
- Does not re-read or re-charge the source.
- OAuth required: `link2ai:read`.

### get_usage
Reads the connected user's Link2AI plan and authoritative processing-unit balance.

- readOnlyHint: true.
- destructiveHint: false.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

The compatibility `get_video_transcript`, `get_video_time_range`, and `get_video_map` tools remain available on other Link2AI distributions where applicable, but are not exposed on the ChatGPT-specific endpoint.

## Suggested review prompts

1. **GitHub pull request**
   - URL: https://github.com/nodejs/node/pull/65472
   - Ask for the change, the main reviewer concern, and how it was resolved.

2. **Hacker News discussion**
   - URL: https://news.ycombinator.com/item?id=37137448
   - Ask for the strongest disagreements and supporting reasons.

3. **Bluesky post**
   - URL: https://bsky.app/profile/bsky.app/post/3lydpzxb3uc2f
   - Ask for a concise summary of the exact public announcement.

4. **Multi-source comparison**
   - GitHub issue: https://github.com/nodejs/node/issues/65470
   - GitHub pull request: https://github.com/nodejs/node/pull/65472
   - Ask how the issue's reported bug maps to the pull request's fix and reviewer feedback, using `read_public_links` and preserving source attribution.

5. **Usage**
   - Ask: "How many Link2AI processing units do I have left?"
   - Expected: `get_usage` returns `remaining_usage_units`.

Negative review:
- Use https://www.youtube.com/watch?v=M7lc1UVf-VE and verify that the ChatGPT endpoint returns `PLATFORM_BLOCKED` without retrieval or quota use, while the normal user-facing answer stays plain-language and does not expose logs or diagnostics.
- Ask to crawl https://bsky.app/profile/bsky.app and verify that Link2AI refuses a profile/feed crawl.
- Provide https://news.ycombinator.com/item?id=37137448 while explicitly forbidding Link2AI/external fetching and verify no Link2AI tool is invoked.

## Pre-submission gates

- GitHub CI green on the exact production commit.
- Railway API and worker both SUCCESS on the exact production commit.
- `/mcp/openai` MCP scan exposes exactly the intended ChatGPT tool surface with security schemes, output schemas, and accurate annotations.
- OAuth protected-resource metadata for `/mcp/openai` reports the ChatGPT-specific resource.
- Reviewer login works from outside the developer's own network without MFA.
- OpenAI challenge token is configured and externally readable.
- Privacy / Terms / Support pages return 200.
- The new reviewer demo uses only the ChatGPT-specific endpoint and the permitted source matrix.
- The previous Instagram demo is not used for formal submission.
- Re-check the final publisher rights/compliance declarations against the deployed ChatGPT-specific source matrix before checking them.

## Final directory-only requirements

OpenAI's final remote-MCP directory submission also requires:
- a square `interface.logo` asset;
- a square `interface.composerIcon` asset;
- exactly five positive and three negative review cases (see `REVIEW_CASES.md`);
- a reviewer-accessible demo video URL (see `DEMO_VIDEO.md`);
- release notes (see `RELEASE_NOTES.md`);
- a category and availability countries/regions selected in the portal;
- the public developer identity/listing metadata to match the identity actually verified in OpenAI Platform.
