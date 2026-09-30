# OpenAI third-party access audit — 2026-09-30

Purpose: document the production retrieval paths permitted through `/mcp/openai` before the public Plugin Directory submission. This is an engineering compliance record, not a legal opinion.

## OpenAI submission rule being enforced

OpenAI's current Plugin Guidelines require third-party access to use proper authorization and comply with the third party's terms, prohibit unofficial pass-through connectors, and prohibit bypassing third-party restrictions. The App Developer Terms also require the publisher to maintain the rights, licenses, and consents necessary for App Responses.

Because of that requirement, the ChatGPT distribution must fail closed for any source category that does not have a documented authorization/terms basis.

## Included in /mcp/openai

### Bluesky — included

Production path:
- `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread`

Basis:
- Bluesky's HTTP API reference states that most `app.bsky.*` GET endpoints are public and may be called without authentication against `https://public.api.bsky.app`.
- LTA uses the documented public AppView endpoint for exact public posts; it does not scrape the Bluesky website.

Reference:
- https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed

### GitHub Issues / pull requests — included

Production path:
- `https://api.github.com/repos/{owner}/{repo}/issues/{number}`
- `https://api.github.com/repos/{owner}/{repo}/pulls/{number}`
- documented GitHub issue/PR comments, reviews, review comments, and diff representations

Basis:
- GitHub Terms Section H expressly covers use of GitHub APIs, including API use through a third-party product.
- GitHub's Registered Developer Agreement provides an API license for interoperability and integrations, subject to the applicable terms.
- LTA uses GitHub's API rather than scraping GitHub HTML.

References:
- https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- https://docs.github.com/en/site-policy/github-terms/github-registered-developer-agreement

### Hacker News — included

Production path:
- `https://hacker-news.firebaseio.com/v0/item/{id}.json`

Basis:
- Y Combinator's official Hacker News API documentation states that public Hacker News data is made available through the Firebase-backed API and documents the `/v0/` item endpoints.
- LTA uses that official public API for exact Hacker News items and their comment trees.

Reference:
- https://github.com/HackerNews/API

## Excluded from /mcp/openai

The following remain supported where applicable in other LTA distributions, but are blocked before source processing when the distribution profile is `openai`:

- YouTube / Shorts
- Instagram Reels / posts
- TikTok videos / posts
- X posts / media
- Reddit
- arbitrary public webpages / articles
- direct public PDFs

Reason: the current production retrieval paths for these categories do not have a sufficiently documented authorization/terms basis for the OpenAI submission attestation. Public accessibility by itself is not treated as authorization.

Examples of why they are excluded:
- YouTube arbitrary public-video caption/transcript access is not equivalent to the official caption-download authorization model.
- Instagram/TikTok arbitrary public-link extraction is not equivalent to their embed or user-authorized display APIs.
- X production media handling still has a non-API fallback.
- Arbitrary webpage/PDF support cannot pre-establish authorization and terms compliance for every third-party host.
- Reddit remains fail-closed unless approved OAuth Data API credentials are configured, and it is not part of this ChatGPT submission matrix.

## Runtime enforcement

`src/source/policy.ts` must keep the OpenAI allowlist limited to:
- `bluesky`
- `github`
- `hackernews`

The default/Claude distribution must retain its existing source matrix.

Tests must fail if:
- an excluded platform becomes available through the OpenAI profile;
- OpenAI submission/reviewer assets advertise excluded source categories;
- the default/Claude matrix is accidentally narrowed;
- the imported OpenAI Skill diverges from the runtime Skill snapshot;
- the ChatGPT general-audience safety guidance from PRs #131/#133 is removed.

## Pre-Scan gate

Do not run the final OpenAI MCP Scan until all of the following are true:
1. This allowlist is merged and the exact commit is live on both API and worker.
2. Exact-revision CI/public certification is green.
3. The production `/mcp/openai` tool descriptions advertise only the permitted source matrix.
4. The production Skill advertises only the permitted source matrix and retains the general-audience rule.
5. Reviewer cases and demo script contain only permitted source fixtures.
6. Reviewer credentials, domain challenge, privacy, terms, and support endpoints are verified.
7. The six Submit policy attestations are re-read against the then-current OpenAI wording and no unresolved contradiction remains.

Any future OpenAI source expansion requires a fresh authorization/terms audit before the allowlist or submission assets are changed.
