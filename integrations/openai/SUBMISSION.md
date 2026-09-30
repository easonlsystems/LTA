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

**Long description:** Through its ChatGPT-specific distribution, LTA reads exact public GitHub Issues and pull requests only when GitHub reports the repository license as `CC0-1.0`, `0BSD`, or `Unlicense`. LTA verifies that rights condition before creating, reusing, or delivering a ChatGPT read job, returns the verified SPDX identifier with successful results, preserves source identity and completeness, and paginates long results. Other LTA distributions may support additional source types and repository licenses, but those are not exposed through `/mcp/openai` in this submission.

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

The ChatGPT distribution is intentionally narrower than LTA's default/Claude distribution.

Supported exact public sources:
- Public GitHub Issues / pull requests only when GitHub reports the repository SPDX license as `CC0-1.0`, `0BSD`, or `Unlicense`.

Before creating, reusing, or delivering a ChatGPT read job, LTA re-checks the repository license through GitHub's official API. Rights-ineligible and unverifiable repositories fail closed and consume 0 processing units.

Other LTA source types and repository licenses remain available where applicable on other LTA distributions but are not available through `/mcp/openai`. Profiles, feeds, timelines, broad crawling, private/login-only content, and paywall/DRM bypass remain unsupported.

See `RIGHTS_AUDIT.md` for the submission rights basis and fail-closed boundary.

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

1. **Licensed GitHub issue**
   - URL: https://github.com/gnembon/scarpet/issues/408
   - Ask LTA to explain the keepalive bug, reproduction steps, and expected behavior.

2. **Licensed GitHub pull request**
   - URL: https://github.com/gnembon/scarpet/pull/422
   - Ask LTA to summarize the proposed fix and reviewer concerns.

3. **Find inside the pull request**
   - URL: https://github.com/gnembon/scarpet/pull/422
   - Ask LTA to find where `schedule(0, ...)` is discussed and explain the reviewer reasoning.

4. **Multi-source comparison**
   - URLs:
     - https://github.com/gnembon/scarpet/issues/408
     - https://github.com/gnembon/scarpet/pull/422
   - Ask how the reported failure maps to the fix and how review feedback changed the implementation.

5. **Usage**
   - Ask: "How many LTA processing units do I have left?"
   - Expected: `get_usage` returns `remaining_usage_units`.

Negative review:
- Try a GitHub Issue from a repository whose license is not in the rights allowlist and verify LTA fails closed with 0-unit charge.
- Explicitly forbid LTA/external fetching and verify no LTA tool is invoked.
- Include a supported URL only as incidental text and verify LTA is not invoked merely because a URL is present.

## Pre-submission gates

- GitHub CI green on the exact production commit.
- Railway API and worker both SUCCESS on the exact production commit.
- `/mcp/openai` MCP scan exposes exactly the intended ChatGPT tool surface with security schemes, output schemas, and accurate annotations.
- OAuth protected-resource metadata for `/mcp/openai` reports the ChatGPT-specific resource.
- Reviewer login works from outside the developer's own network without MFA.
- OpenAI challenge token is configured and externally readable.
- Privacy / Terms / Support pages return 200.
- The new reviewer demo uses only the ChatGPT-specific endpoint and demonstrates only rights-eligible GitHub Issue/PR reads from the final review cases.
- The demo shows `source_license_spdx` on a successful read and a fail-closed rights-ineligible example if time permits.
- Re-check the final publisher rights/compliance declarations against the deployed ChatGPT-specific source matrix before checking them.
- Do not expand `/mcp/openai` to additional source types unless their production retrieval path has a documented authorization/terms basis and this checklist is re-audited.

## Final directory-only requirements

OpenAI's final remote-MCP directory submission also requires:
- a square `interface.logo` asset;
- a square `interface.composerIcon` asset;
- exactly five positive and three negative review cases (see `REVIEW_CASES.md`);
- a reviewer-accessible demo video URL (see `DEMO_VIDEO.md`);
- release notes (see `RELEASE_NOTES.md`);
- a category and availability countries/regions selected in the portal;
- the public developer identity/listing metadata to match the identity actually verified in OpenAI Platform.
