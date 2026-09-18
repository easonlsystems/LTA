# Provider redundancy evaluation — 2026-09-19

## Decision

Do not add RapidAPI, Apify, or another paid/social-scraping provider to production yet.

The immediate reliability foundation is already in production: Link2AI now has explicit provider chains, failover rules, privacy-preserving provider-health telemetry, and a vendor-neutral external-provider slot. The next decision should be driven by real failure data rather than adding a provider speculatively.

Provider redundancy and platform authorization are separate questions. A third-party provider may improve uptime, but its ability to retrieve public content does not by itself grant Link2AI the rights or platform authorization needed for every distribution channel.

## Current Link2AI provider chains

- X video metadata: structured X embed metadata → optional external provider.
- X audio: structured X media → yt-dlp audio path → optional external provider.
- Other supported social/video media: yt-dlp → optional external provider.
- YouTube: yt-dlp plus the existing transcript fallback where applicable.
- Instagram / TikTok post text: gallery-dl → public-page extraction.
- Definitive access errors stop the chain; only eligible/recoverable failures fan out.
- Failed reads remain zero processing units under the existing worker quota-release path.

The optional managed-provider adapter remains behind `MEDIA_PROVIDER_URL`. No external vendor is currently required by the chain.

## Candidate assessment

### 1. X official API — highest-priority candidate

Status: **evaluate first**.

X's current official API supports Post media expansion and media fields including `duration_ms`, `type`, `url`, and `variants`. That is a much better fit for Link2AI's X media identity/metadata needs than inferring media from post HTML or relying only on a generic extractor.

Potential role:

`X API → existing structured-X route → yt-dlp audio fallback → optional managed provider`

Before adoption:

- confirm the exact Post lookup endpoint and plan available to the Link2AI account;
- confirm commercial-use terms and current pricing;
- confirm whether returned media variants may be fetched/processed for Link2AI's use case;
- test against the real X failure corpus already collected.

This is the only candidate in this note that could improve both reliability and provenance because it is a first-party source API.

Sources:
- https://docs.x.com/x-api/posts/english-language-firehose-stream
- https://docs.x.com/

### 2. TikTok Display API — official but not a general arbitrary-link fallback

Status: **not suitable as the generic Link2AI TikTok fallback**.

TikTok's Display API exposes user/video metadata through OAuth scopes such as `video.list`. The documented setup requires a TikTok developer app, product approval, Login Kit, and authorization from a TikTok account.

That makes it useful for an account-authorized integration, but it does not match Link2AI's current requirement of receiving an arbitrary public TikTok URL from a user and reading that source without the creator authorizing Link2AI.

Potential future use:

- creator-authorized TikTok integrations;
- a separate first-party/authorized source route.

Sources:
- https://developers.tiktok.com/docs/en/display-api-overview
- https://developers.tiktok.com/docs/en/display-api-get-started

### 3. YouTube official APIs — metadata yes; arbitrary audio/ASR fallback no

Status: **do not treat as a replacement for the current media-processing path**.

YouTube's official developer policy states that API clients must not download, import, back up, cache, or store copies of YouTube audiovisual content without prior written approval.

Therefore an official YouTube Data API integration may be appropriate for metadata/provenance, but it does not automatically authorize the audio-download/ASR behavior Link2AI currently needs for arbitrary videos.

Before any formal OpenAI-distribution use, obtain an authorization basis appropriate to that path rather than assuming a third-party provider fixes it.

Source:
- https://developers.google.com/youtube/terms/developer-policies

### 4. Apify — strongest generic reliability vendor to benchmark, not auto-adopt

Status: **good candidate for controlled shadow testing if needed**.

Apify provides one API surface for Actors and has current Store actors for X, Instagram, and YouTube. Pricing can be pay-per-result or compute based; its current platform pricing also includes a free allowance.

Why it is technically attractive:

- one integration surface can host multiple source-specific actors;
- synchronous API execution is available;
- pay-per-result models can fit a Link2AI unit-backed cost model;
- it can be placed behind the existing vendor-neutral `MEDIA_PROVIDER_URL` adapter.

Why it is not being adopted now:

- many social Actors are community/third-party scrapers;
- Actor quality and schemas differ by developer;
- using an Actor does not itself prove platform authorization or content rights;
- it adds another operational dependency before Link2AI has enough provider-health data to know where it is actually needed.

Suggested validation if production telemetry later justifies it:

1. pick one failing source only;
2. run a shadow corpus against one maintained Actor;
3. record success rate, latency, completeness, and cost per successful Link2AI read;
4. do not expose the provider to users until the source-specific legal/terms review is acceptable;
5. cap spend and retain the clean-failure path.

Current public pricing/examples reviewed:
- Apify platform: https://apify.com/pricing
- maintained YouTube actor: https://apify.com/streamers/youtube-scraper/api
- example X actors: https://apify.com/eiv/twitter-scraper and https://apify.com/tweetapi/twitter-x-search-scraper/api
- example Instagram actor: https://apify.com/omaraw/instagram-scraper

### 5. RapidAPI marketplace — source-specific backup only after individual vetting

Status: **do not build a generic RapidAPI fallback adapter around marketplace listings**.

RapidAPI currently contains multiple independent providers for YouTube transcripts, Instagram/Reels downloading, TikTok downloading, and X/Twitter data. Some have free or low-cost tiers.

The problem is that "RapidAPI" is only the marketplace/gateway. The underlying provider, implementation, reliability, terms, pricing, and data provenance differ per listing. A marketplace subscription therefore cannot be treated as one trusted source provider.

Examples found during this review include:

- YouTube transcript APIs;
- Instagram/Reels downloader APIs;
- TikTok downloader APIs;
- X/Twitter data APIs.

If one is ever considered, vet the individual provider exactly like a standalone vendor and put it behind a source-specific adapter. Never use marketplace availability as evidence that platform terms or rights are satisfied.

Sources:
- https://rapidapi.com/thisisgazzar/api/youtube-transcript1
- https://rapidapi.com/7scorp-7scorp-default/api/tiktok-downloader-download-tiktok-videos-without-watermark/pricing
- https://rapidapi.com/xtwitter/api/twitter288/pricing
- https://rapidapi.com/codecrest8/api/instagram-reels-downloader2
- https://docs.rapidapi.com/v1.0/docs/configuring-api-authentication

## Recommended next sequence

1. **Observe production provider health first.** Let the new hourly telemetry collect a real failure sample by platform/provider/operation.
2. **Evaluate X official API first.** It is the clearest first-party candidate and directly addresses recent real-user X failures.
3. **Do not add a generic paid fallback yet.**
4. If one source still has material recoverable failures, run an isolated shadow benchmark against a single candidate provider (Apify is the first generic vendor worth benchmarking).
5. Add a paid provider only when all four are known:
   - measurable reliability gain;
   - acceptable latency;
   - unit economics fit Link2AI's processing-unit model;
   - source-specific authorization/terms review is acceptable.
6. Preserve `primary → fallback(s) → clean failure` and zero-unit final failures.

## Product boundary

Provider redundancy solves source availability. It does not solve visual understanding. Link2AI V3 still returns spoken/captioned/textual context and should continue to mark `visual_content_included=false` until frame-level visual understanding is actually implemented and verified.
