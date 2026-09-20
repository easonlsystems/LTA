# LTA — ChatGPT / Codex public plugin submission

## Submission type

**Contains MCP** with an optional bundled skill.

Production ChatGPT-specific MCP URL:

`https://api-production-0383e.up.railway.app/mcp/openai`

MCP URL type: **Universal**.

The general LTA `/mcp` endpoint is not the OpenAI submission endpoint.

## Public listing

**Plugin name:** LTA

**Short description:** Read supported exact public links when the original source is not reliably available to the AI.

**Long description:** Through its ChatGPT-specific distribution, LTA retrieves AI-readable source context from the same supported exact public-link categories as its default/Claude distribution, including YouTube / Shorts, Instagram Reels and supported public posts, TikTok, individual public X and Bluesky posts, GitHub Issues / pull requests, Hacker News discussions, readable public webpages / articles, and text-layer PDFs. Reddit exact public posts are available only when approved Reddit OAuth Data API credentials are configured. LTA preserves source identity, reports incomplete upstream results honestly, and paginates long results without treating delivery chunk size as a source-size limit.

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

A token issued for the general LTA `/mcp` resource is not accepted by `/mcp/openai`. For compatibility with already-installed ChatGPT connectors whose runtime may still POST to legacy `/mcp`, an OpenAI-scoped `/mcp/openai` token presented there is routed only to the restricted five-tool OpenAI handler; it never gains access to the general `/mcp` tool surface.

Normal users sign in to LTA with Google. OpenAI reviewers use the dedicated reviewer email/password flow exposed on the LTA sign-in page. Reviewer credentials are configured only in production environment variables and must be supplied privately in the submission portal. The reviewer flow must not require MFA or any out-of-band verification.

## OpenAI domain challenge

The production route is:

`/.well-known/openai-apps-challenge`

Keep the submission-portal challenge token configured in production and verify the route returns it verbatim before submission.

## ChatGPT distribution source policy

The ChatGPT distribution intentionally uses the same supported-source matrix as LTA's default/Claude distribution.

Supported exact public sources:
- YouTube videos and YouTube Shorts.
- TikTok videos and supported public posts.
- Instagram Reels and supported public posts.
- Individual public X posts.
- Individual public Bluesky posts.
- Public GitHub Issues / pull requests and their public discussion.
- Hacker News items / discussions.
- Readable public HTTPS webpages / articles.
- Direct public text-layer PDFs.
- Individual public Reddit posts when approved Reddit OAuth Data API credentials are configured.

The ChatGPT-specific endpoint may expose a smaller tool surface than the default/Claude distribution, but source availability must not be reduced because of that packaging difference. LTA still does not support profiles, feeds, timelines, bulk crawling, private/login-only content, paywall or DRM bypass, or visual-only understanding that is not represented in returned text.

## Tool review notes

The ChatGPT-specific MCP endpoint exposes five tools.

### read_public_link
Starts or reuses a LTA source-reading job for one allowed exact public URL.

- readOnlyHint: false — it can create a job and consume LTA processing units.
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
Reads the connected user's LTA plan and authoritative processing-unit balance.

- readOnlyHint: true.
- destructiveHint: false.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

The compatibility `get_video_transcript`, `get_video_time_range`, and `get_video_map` tools remain available on other LTA distributions where applicable, but are not exposed on the ChatGPT-specific endpoint.

## Suggested review prompts

1. **Instagram Reel**
   - URL: https://www.instagram.com/reel/DdNnHPip4RD/
   - Ask LTA to summarize the main points and specific claims from the Reel.

2. **YouTube**
   - URL: https://www.youtube.com/watch?v=M7lc1UVf-VE
   - Ask LTA to summarize what the video explains.

3. **Hacker News discussion**
   - URL: https://news.ycombinator.com/item?id=37137448
   - Ask for the strongest disagreements and supporting reasons.

4. **Multi-source GitHub comparison**
   - GitHub issue: https://github.com/nodejs/node/issues/65470
   - GitHub pull request: https://github.com/nodejs/node/pull/65472
   - Ask how the issue's reported bug maps to the pull request's fix and reviewer feedback, using `read_public_links` and preserving source attribution.

5. **Usage**
   - Ask: "How many LTA processing units do I have left?"
   - Expected: `get_usage` returns `remaining_usage_units`.

Negative review:
- Ask LTA to crawl every post from a public profile/feed and verify that broad crawling is refused.
- Explicitly forbid LTA/external fetching and verify no LTA tool is invoked.
- Include a supported URL only as incidental text (for example, "Save this link for later") and verify LTA is not invoked merely because a URL is present.

## Pre-submission gates

- GitHub CI green on the exact production commit.
- Railway API and worker both SUCCESS on the exact production commit.
- `/mcp/openai` MCP scan exposes exactly the intended ChatGPT tool surface with security schemes, output schemas, and accurate annotations.
- OAuth protected-resource metadata for `/mcp/openai` reports the ChatGPT-specific resource.
- Reviewer login works from outside the developer's own network without MFA.
- OpenAI challenge token is configured and externally readable.
- Privacy / Terms / Support pages return 200.
- The new reviewer demo uses only the ChatGPT-specific endpoint and demonstrates the same source matrix users receive through the default/Claude distribution.
- The reviewer demo includes at least one high-value media source such as an Instagram Reel or YouTube video.
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
