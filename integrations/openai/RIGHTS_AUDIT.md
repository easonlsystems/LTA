# OpenAI third-party rights audit — 2026-09-30

Purpose: document the source-access and content-rights boundary enforced through `/mcp/openai` before public Plugin Directory submission. This is an engineering compliance record, not legal advice.

## OpenAI requirements being enforced

OpenAI's current Plugin Guidelines require third-party access to use proper authorization and comply with the third party's terms, prohibit unauthorized scraping / pass-through access, and prohibit bypassing third-party restrictions.

OpenAI's App Developer Terms also require the publisher to maintain the rights, licenses, and consents necessary for App Responses. Because App Responses may be stored, copied, displayed, modified, distributed, and used by OpenAI and plugin users, API access permission alone is not treated as sufficient evidence for arbitrary third-party content.

References:
- https://developers.openai.com/plugins/plugin-guidelines
- https://openai.com/policies/developer-apps-terms/

## Included in /mcp/openai

### GitHub Issues / pull requests — only rights-eligible repositories

Production source paths:
- `https://api.github.com/repos/{owner}/{repo}/issues/{number}`
- `https://api.github.com/repos/{owner}/{repo}/pulls/{number}`
- documented GitHub issue comments, pull-request reviews, inline review comments, and diff representations used by LTA

Access basis:
- GitHub Terms Section H expressly covers GitHub API use, including API use through a third-party product.
- GitHub's public REST endpoints can be used to retrieve public repository resources subject to GitHub's Terms and rate limits.
- LTA uses GitHub's API rather than scraping GitHub HTML.

Content-rights basis:
- GitHub Terms Section D states that public issues, comments, and contributions are User-Generated Content.
- Section D.6 states that when a user adds Content to a repository containing notice of a license, that Content is licensed under the same repository license.
- Section D.8 states that GitHub's Terms do not otherwise restrict lawful third-party access to or use of public repository contents.
- LTA therefore requires GitHub's repository metadata to report one of the deliberately narrow licenses below before a ChatGPT read can be created, reused, or delivered:
  - `CC0-1.0`
  - `0BSD`
  - `Unlicense`

Why the allowlist is intentionally narrow:
- These licenses are selected because they are designed to permit downstream reuse with minimal or no notice / attribution obligations.
- Common licenses such as MIT and Apache-2.0 remain blocked in this submission because they introduce notice / attribution conditions that the current ChatGPT response contract does not yet enforce end to end.
- Unknown, missing, or `NOASSERTION` licenses fail closed.

References:
- https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- https://docs.github.com/en/rest/issues/issues
- https://docs.github.com/en/rest/pulls/pulls

Verified reviewer fixture:
- repository: `gnembon/scarpet`
- GitHub-detected SPDX license: `CC0-1.0`
- issue: https://github.com/gnembon/scarpet/issues/408
- pull request: https://github.com/gnembon/scarpet/pull/422

## Excluded from /mcp/openai

The following remain supported where applicable in other LTA distributions, but are blocked before ChatGPT source processing:
- YouTube / Shorts
- Instagram Reels / posts
- TikTok videos / posts
- X posts / media
- Reddit
- Bluesky
- Hacker News
- arbitrary public webpages / articles
- direct public PDFs
- GitHub repositories whose detected SPDX license is not `CC0-1.0`, `0BSD`, or `Unlicense`

Reason: public accessibility or an official read API by itself is not treated as sufficient evidence that LTA can grant the downstream App Response rights required by OpenAI.

## Runtime enforcement

The ChatGPT path has two separate fail-closed gates:

1. `src/source/policy.ts`
   - the OpenAI profile permits only the `github` platform;
   - default / Claude source support is unchanged.

2. `src/source/openaiRights.ts`
   - resolves the GitHub repository from the exact Issue / PR URL;
   - fetches GitHub repository metadata through the official API;
   - requires `CC0-1.0`, `0BSD`, or `Unlicense`;
   - returns rights evidence containing repository identity and SPDX id;
   - fails closed on unsupported, unknown, or unverifiable licenses.

`src/source/service.ts` applies the rights check:
- before creating a new ChatGPT source job;
- before same-user cache reuse;
- again when `get_transcript_result` delivers an existing job, preventing old or cross-client cached content from bypassing the rights boundary.

Successful ChatGPT results expose `source_license_spdx`.

## Submission consistency requirements

Tests must fail if:
- any non-GitHub platform becomes available through the OpenAI profile;
- MIT, Apache-2.0, unknown, or missing-license GitHub repositories become ChatGPT-eligible;
- the default / Claude source matrix is narrowed;
- reviewer fixtures stop using a rights-eligible repository;
- submission copy advertises excluded source categories;
- the imported Skill diverges from the runtime Skill;
- the general-audience safeguards from #131 / #133 are removed;
- a rights-ineligible cached job can be delivered through ChatGPT.

## Pre-Scan gate

Do not run the final OpenAI MCP Scan until all of the following are true:
1. The GitHub-only rights gate is merged.
2. The exact merged commit is live on both Railway API and worker.
3. Exact-revision CI and public certification are green.
4. The production `/mcp/openai` tool list and descriptions match this rights boundary.
5. The production Skill matches this rights boundary.
6. The five positive and three negative review cases match this rights boundary.
7. Reviewer credentials, domain challenge, privacy, terms, and support endpoints are verified.
8. The final demo is recorded against the exact production revision.
9. The six Submit policy attestations are re-read against the then-current OpenAI wording and no unresolved contradiction remains.

Any future expansion of the ChatGPT source matrix requires a new rights / terms audit before the allowlist, Skill, review cases, or listing is changed.
