# LTA — ChatGPT / Codex public plugin submission

## Submission type

**Contains MCP** with one bundled Skill.

Production ChatGPT-specific MCP URL:

`https://api-production-0383e.up.railway.app/mcp/openai`

MCP URL type: **Universal**.

The general LTA `/mcp` endpoint is not the OpenAI submission endpoint.

## Public listing

**Plugin name:** LTA

**Short description:** Check LTA source compatibility, estimate processing units, and view your LTA account usage.

**Long description:** LTA's public ChatGPT directory plugin is a first-party account and planning companion. It checks whether a user-provided URL string matches an LTA-supported source format without contacting the linked site, lists LTA source compatibility categories, estimates processing units from user-provided size or duration, and reads the authenticated user's first-party LTA usage balance. This directory distribution does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs.

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

A token issued for the general LTA `/mcp` resource is not accepted by `/mcp/openai`. For compatibility with already-installed ChatGPT connectors whose runtime may still POST to legacy `/mcp`, an OpenAI-scoped `/mcp/openai` token presented there is routed to the same restricted first-party OpenAI handler; it never gains access to the general `/mcp` source-reading tool surface.

Normal users sign in to LTA with Google. OpenAI reviewers use the dedicated reviewer email/password flow exposed on the LTA sign-in page. Reviewer credentials are configured only in production environment variables and must be supplied privately in the submission portal. The reviewer flow must not require MFA or any out-of-band verification.

## OpenAI domain challenge

The production route is:

`/.well-known/openai-apps-challenge`

Keep the submission-portal challenge token configured in production and verify the route returns it verbatim before submission.

## Public-directory capability boundary

The submitted `/mcp/openai` endpoint exposes exactly four tools and none of them retrieves third-party content.

### check_link_support
Locally parses a user-provided HTTPS URL string and reports whether its shape matches an exact source format recognized by LTA.

- Does not contact the linked host.
- Does not return the source contents.
- Does not echo the URL in its tool result.
- Returns `directory_content_access=false` and `network_request_made=false`.
- Adult-domain URLs fail closed under the general-audience gate.
- readOnlyHint: true.
- destructiveHint: false.
- idempotentHint: true.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

### get_supported_sources
Returns LTA-owned product capability metadata describing source categories recognized by the broader LTA product.

- Does not call the listed platforms.
- Does not make the external sources readable through the directory plugin.
- readOnlyHint: true.
- destructiveHint: false.
- idempotentHint: true.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

### estimate_processing_units
Calculates an LTA processing-unit estimate from a duration or character count supplied in the App Request.

- Video: one unit per started minute.
- Text: four characters per estimated token and 2,500 estimated tokens per unit.
- No URL or external source is fetched to obtain the input.
- readOnlyHint: true.
- destructiveHint: false.
- idempotentHint: true.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

### get_usage
Returns the authenticated user's first-party LTA plan and processing-unit usage/balance.

- Reads LTA's own database only.
- Does not expose email, auth tokens, internal IDs, concurrency state, exemption flags, purchase links, or checkout links.
- readOnlyHint: true.
- destructiveHint: false.
- idempotentHint: true.
- openWorldHint: false.
- OAuth required: `link2ai:read`.

## Deliberately excluded from the public-directory endpoint

The broader LTA product may read supported public links through other distributions, including the default/Claude MCP endpoint. The following are **not** available through `/mcp/openai`:

- `read_public_link`
- `read_public_links`
- `get_transcript_result`
- `get_visual_assets`
- `find_in_link`
- `get_video_transcript`
- `get_video_time_range`
- `get_video_map`
- any third-party scraping, media-download, page-fetch, API-relay, transcript, ASR, or source-content provider path

This separation is intentional. The Directory submission is not an unofficial connector or pass-through intermediary for Instagram, YouTube, TikTok, X, GitHub, Hacker News, Reddit, Bluesky, webpages, PDFs, or any other third-party service.

## Suggested review prompts

1. `Does LTA recognize this kind of link? https://www.instagram.com/reel/DdNnHPip4RD/`
2. `What source types does LTA currently support?`
3. `About how many LTA processing units would a 125-second video need?`
4. `Estimate the LTA processing units for 25,000 characters of text.`
5. `How many LTA processing units do I have left?`

Negative review:
- Ask LTA to read/summarize a YouTube URL and verify that no source-reading tool exists and no source content is claimed.
- Ask compatibility for a known adult-domain URL and verify the general-audience blocked result with no network request.
- Include a URL incidentally and verify LTA is not invoked merely because a URL is present.

## Final policy-attestation evidence map

This section is an engineering evidence checklist for the six policy statements shown in the OpenAI submission portal. The publisher still makes the final legal attestations.

### 1. Terms + Plugin Guidelines
- `/mcp/openai` operates on LTA-owned account/product data or user-supplied scalar/string inputs.
- It does not scrape external websites, relay queries, or integrate third-party APIs.
- It therefore does not primarily function as an unofficial connector or pass-through intermediary.
- Tool descriptions, Skill, review cases, demo, and listing must match the four-tool production behavior exactly.

### 2. Applicable laws and regulations
- The submitted tools do not provide financial execution, medical services, gambling, regulated transfers, or third-party-content redistribution.
- The authenticated account-data tool returns only the minimum LTA usage fields needed for the user's request.
- Privacy, Terms, and Support pages must be live and accurate before submission.
- The publisher must still make the final legal attestation based on its own circumstances.

### 3. No money / crypto / investment transfers
- All four submitted tools are read-only.
- No tool initiates or executes payments, money transfers, cryptocurrency transfers, or investment trades.
- No tool returns checkout, purchase, upgrade, subscription, or top-up links.

### 4. Necessary rights for third-party content / API endpoints
- The submitted `/mcp/openai` tool path does not access or return third-party website content or third-party API responses.
- `check_link_support` parses only the URL string contained in the App Request and does not contact the URL.
- `get_supported_sources` returns LTA-owned product metadata.
- `estimate_processing_units` returns an LTA-owned deterministic calculation.
- `get_usage` returns first-party LTA account data.
- App Responses from this submission therefore do not depend on licensing third-party source contents into OpenAI.

### 5. Suitable for individuals under 18 / no mature or adult content
- The Directory tools do not retrieve external content.
- `check_link_support` applies the existing general-audience domain gate before classifying a URL.
- Known adult-domain URLs return a generic blocked response and are not contacted.

### 6. Does not target children under 13 or share their personal information with OpenAI
- LTA is not marketed or designed as a child-under-13 product.
- Submitted tool outputs do not include account email, name, auth credentials, or other child/person identity fields.
- `get_usage` returns plan and aggregate unit counters only.

## Pre-Scan gates

Do **not** run the final OpenAI MCP Scan until all of the following are true:

- The first-party OpenAI submission branch is merged to `main`.
- Railway API and worker are both SUCCESS on that exact merged revision.
- GitHub CI is green on that exact revision.
- Exact-revision public production certification is green.
- Production `/mcp/openai` exposes exactly: `check_link_support`, `get_supported_sources`, `estimate_processing_units`, `get_usage`.
- Production `/mcp/openai` exposes none of the source-reading tools listed above.
- Production initialization text states that the Directory distribution does not fetch or return third-party contents.
- The imported Skill is exactly `use-lta-account-and-source-planning` and contains no source-reading workflow.
- A production compatibility check returns `network_request_made=false` and `directory_content_access=false`.
- An adult-domain compatibility check returns `blocked` and makes no network request.
- OAuth protected-resource metadata for `/mcp/openai` reports the ChatGPT-specific resource.
- Reviewer login works externally without MFA.
- The OpenAI domain challenge token is configured and externally readable.
- Privacy / Terms / Support pages return 200.
- The five positive and three negative reviewer cases match production.
- The reviewer demo is recorded against the exact production revision and shows no third-party source content retrieval.
- The current wording of all six Submit policy statements is re-read immediately before checking them, and no new policy/version change creates a contradiction.

Only after every gate above passes should Scan Tools be run for the final submission snapshot.

## Final directory-only requirements

OpenAI's final remote-MCP directory submission also requires:
- a square `interface.logo` asset;
- a square `interface.composerIcon` asset;
- exactly five positive and three negative review cases;
- a reviewer-accessible demo video URL;
- release notes;
- a category and availability countries/regions selected in the portal;
- the public developer identity/listing metadata to match the identity actually verified in OpenAI Platform.
