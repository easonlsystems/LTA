# LTA — OpenAI review cases

Use the dedicated production reviewer account supplied privately in the OpenAI submission portal. No MFA, email confirmation, SMS confirmation, or private-network access may be required.

The public ChatGPT directory distribution is a first-party LTA account and planning companion. It does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs. The broader LTA product may support external source reading in other distributions; that capability is not exposed through `/mcp/openai`.

## Positive cases — exactly 5

### P1 — Check an Instagram Reel URL format
**Prompt**
Does LTA recognize this kind of link? https://www.instagram.com/reel/DdNnHPip4RD/

**Expected behavior**
- Invoke `check_link_support` with the user-provided URL.
- Return that LTA recognizes the URL as an Instagram Reel / post source format.
- Return `directory_content_access=false` and `network_request_made=false`.
- Do not claim to have opened, read, verified, summarized, or fetched the Reel.

**Expected result structure**
A compatibility answer only, clearly distinguishing broader LTA support from this directory plugin's content-access boundary.

### P2 — List LTA source compatibility
**Prompt**
What source types does LTA currently support?

**Expected behavior**
- Invoke `get_supported_sources`.
- Return the current LTA source categories and whether Reddit is currently available on the deployment.
- State that the directory plugin reports compatibility only and does not fetch those sources.

**Expected result structure**
A concise source-compatibility list with the directory content-access limitation.

### P3 — Estimate video processing units
**Prompt**
About how many LTA processing units would a 125-second video need?

**Expected behavior**
- Invoke `estimate_processing_units` with `content_kind=video` and `duration_seconds=125`.
- Return 3 estimated processing units.
- Do not fetch any video or inspect an external URL.

**Expected result structure**
An estimate of 3 processing units with the one-unit-per-started-minute basis.

### P4 — Estimate text processing units
**Prompt**
Estimate the LTA processing units for 25,000 characters of text.

**Expected behavior**
- Invoke `estimate_processing_units` with `content_kind=text` and `character_count=25000`.
- Return 3 estimated processing units using four characters per estimated token and 2,500 estimated tokens per unit.
- Use only the character count supplied in the prompt.

**Expected result structure**
An estimate of 3 processing units with the text-estimation basis.

### P5 — Usage balance
**Prompt**
How many LTA processing units do I have left?

**Expected behavior**
- Invoke `get_usage`.
- Read only the authenticated review account's first-party LTA plan and processing-unit balance.
- Use `remaining_usage_units` as the authoritative remaining balance.
- Do not expose auth secrets, internal identifiers, concurrency state, exemption flags, purchase links, or checkout links.

**Expected result structure**
Plan plus remaining processing units.

## Negative cases — exactly 3

### N1 — Request requires third-party source contents
**Prompt**
Use LTA to read and summarize this YouTube video: https://www.youtube.com/watch?v=M7lc1UVf-VE

**Expected behavior**
Do not claim that LTA read the video and do not invoke a hidden source-reading path. Explain that this public-directory LTA distribution provides account, compatibility, and unit-planning functions only. It cannot return the contents behind the URL.

**Why the plugin must not complete the requested operation**
The submitted MCP intentionally has no third-party content retrieval tools or provider path.

### N2 — Adult-domain compatibility check
**Prompt**
Does LTA support this URL format? https://www.pornhub.com/view_video.php?viewkey=abc

**Expected behavior**
Invoke `check_link_support`, return a general-audience `blocked` result, keep `network_request_made=false`, and do not infer or describe the external content.

**Why the plugin must not complete the requested operation**
The public ChatGPT distribution is general-audience only.

### N3 — URL is incidental
**Prompt**
Save this link for later: https://www.instagram.com/reel/DdNnHPip4RD/

**Expected behavior**
Do not invoke LTA merely because a URL appears in the conversation.

**Why the plugin must not complete the requested operation**
The request does not ask for LTA compatibility, account data, or unit planning.
