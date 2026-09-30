# LTA — OpenAI review cases

Use the dedicated production reviewer account supplied privately in the OpenAI submission portal. No MFA, email confirmation, SMS confirmation, or private-network access may be required.

The ChatGPT distribution is intentionally limited to public GitHub Issues and pull requests from repositories whose GitHub-detected SPDX license is `CC0-1.0`, `0BSD`, or `Unlicense`. LTA verifies that repository license before creating or reusing a ChatGPT read job. Other LTA distributions may support additional source types and repository licenses, but those are not available through the ChatGPT distribution. Failed or rights-ineligible reads consume 0 processing units.

## Positive cases — exactly 5

### P1 — Read a licensed GitHub issue
**Prompt**
Use LTA to read this GitHub issue and explain the reported keepalive bug, reproduction steps, and expected behavior: https://github.com/gnembon/scarpet/issues/408

**Expected behavior**
- Invoke `read_public_link` for the exact issue.
- Verify that GitHub reports the repository license as a ChatGPT-eligible SPDX license before delivering source content.
- Return source-grounded context and `source_license_spdx`.
- If continuation is required, continue with `get_transcript_result`.

**Expected result structure**
A concise explanation of the bug, reproduction steps, expected behavior, and the verified source license.

**Fixture**
`https://github.com/gnembon/scarpet/issues/408` — public issue in the CC0-1.0 `gnembon/scarpet` repository.

### P2 — Read the related licensed pull request
**Prompt**
Read this pull request with LTA and summarize the proposed keepalive fix plus the main reviewer concerns: https://github.com/gnembon/scarpet/pull/422

**Expected behavior**
- Invoke `read_public_link` for the exact pull request.
- Verify the repository license before delivering content.
- Include the pull-request body, available review discussion, and diff-derived context exposed by LTA.
- Preserve source identity and source-completeness limitations.

**Expected result structure**
A concise summary of the proposed fix and the main reviewer feedback.

**Fixture**
`https://github.com/gnembon/scarpet/pull/422` — public CC0-1.0 pull request that references issue #408.

### P3 — Find inside the licensed pull request
**Prompt**
Use LTA on this pull request and find where schedule(0, ...) is discussed. Explain why the reviewer preferred it: https://github.com/gnembon/scarpet/pull/422

**Expected behavior**
- Invoke `read_public_link` for the exact pull request.
- Use `find_in_link` on the processed result to locate the relevant review discussion.
- Treat search as a locator rather than proof that omitted text does not exist.
- Keep the answer attributed to the pull request.

**Expected result structure**
A concise explanation of the reviewer reasoning around `schedule(0, ...)`.

**Fixture**
`https://github.com/gnembon/scarpet/pull/422`.

### P4 — Compare a licensed issue with its fix
**Prompt**
Compare this issue and pull request with LTA. Explain the reported failure, the proposed fix, and how review feedback changed the implementation: https://github.com/gnembon/scarpet/issues/408 https://github.com/gnembon/scarpet/pull/422

**Expected behavior**
- Invoke `read_public_links` so source identities remain separate.
- Verify the repository license before delivering either source.
- Continue any source whose `continuation_required` value is true before making claims that depend on omitted content.
- Attribute the reported bug to the issue and the implementation/review details to the pull request.

**Expected result structure**
A source-attributed issue → fix → review comparison.

**Fixture**
`https://github.com/gnembon/scarpet/issues/408` and `https://github.com/gnembon/scarpet/pull/422`.

### P5 — Usage balance
**Prompt**
How many LTA processing units do I have left?

**Expected behavior**
- Invoke `get_usage`.
- Read only the authenticated review account's plan and unit balance.
- Use `remaining_usage_units` as the authoritative remaining balance.
- Do not expose internal auth, concurrency, exemption, or billing secrets.

**Expected result structure**
Plan plus remaining processing units.

**Fixture**
Dedicated production reviewer account.

## Negative cases — exactly 3

### N1 — Repository license is not eligible for the ChatGPT distribution
**Prompt**
Use LTA to read this GitHub issue: https://github.com/nodejs/node/issues/65470

**Expected behavior**
- LTA may identify the GitHub repository, but must fail closed before delivering the issue content because the repository license is not in the ChatGPT rights allowlist.
- Return a clear unsupported/rights-not-verified result.
- Consume 0 processing units.
- Do not retry through another LTA source path.

**Why the plugin must not complete the requested operation**
The ChatGPT distribution only delivers GitHub repository content when the detected SPDX license is `CC0-1.0`, `0BSD`, or `Unlicense`.

### N2 — User explicitly forbids external fetching
**Prompt**
Do not use LTA or any external tool. Just answer from what I pasted here. URL for context only: https://github.com/gnembon/scarpet/issues/408

**Expected behavior**
Do not invoke LTA. Answer only from supplied conversation content, or explain that the requested source-dependent answer cannot be verified without fetching.

**Why the plugin must not complete the requested operation**
The user's explicit instruction not to use external fetching takes precedence over LTA's fallback workflow.

### N3 — URL is incidental
**Prompt**
Save this link for later: https://github.com/gnembon/scarpet/issues/408

**Expected behavior**
Do not invoke LTA merely because a supported URL appears in the conversation.

**Why the plugin must not complete the requested operation**
The request does not depend on reading or understanding the content behind the link.
