# Link2AI cumulative link expansion + Reddit — 2026-09-15

> Historical implementation record, superseded by the current source. Current production supports and advertises Reddit only when Reddit OAuth credentials are configured; it does not use anonymous Reddit JSON or HTML scraping fallbacks.

## Baseline

Production baseline when this package was prepared:

- Commit: `c8c0182cf2600b0d72ee1ff9f5b406a0e2af17fb`
- Message: `Backfill historical website analytics`

This package **supersedes** `Link2AI_CUMULATIVE_LINK_EXPANSION_20260915.zip`.
Do not apply the older link-expansion package first. Apply this package once on top of the current production repository.

The historical analytics backfill is already present in production. The cumulative SQL carried here remains idempotent so applying this package does not duplicate the historical backfill.

## Product scope after this update

Link2AI remains a thin access layer. The host AI still reasons and answers.

Supported public link types:

- YouTube / YouTube Shorts videos
- TikTok videos
- Instagram Reels
- Instagram public posts
- TikTok photo posts when public text is exposed
- Individual public X posts
- **Individual public Reddit posts**
- Readable public HTTPS webpages / articles

The public product copy is now link-first: `Paste a link. Your AI can read it.`

## Reddit native support

Accepted Reddit post forms include:

- `reddit.com/r/<subreddit>/comments/<post_id>/...`
- `reddit.com/comments/<post_id>/...`
- `old.reddit.com/.../comments/<post_id>/...`
- `reddit.com/gallery/<post_id>`
- `redd.it/<post_id>`
- Reddit mobile opaque share links such as `reddit.com/r/<subreddit>/s/<share_token>`

For a normal public Reddit post, Link2AI returns bounded AI-readable context containing:

- subreddit/community
- post title
- author
- self-text/body when present
- linked external URL for link posts when present
- up to 40 public comments, preserving reply depth up to 4 levels
- comment scores when Reddit exposes them

Deleted/removed comment bodies are skipped. `more` placeholders are not expanded, so Link2AI does not crawl an unbounded thread.

Reddit JSON is tried through the public post endpoints first. A bounded old-Reddit public HTML fallback is available for temporary JSON endpoint failures. Private/login-gated content is not bypassed.

### Opaque `/s/` share links

Opaque Reddit mobile share links must first resolve to the canonical public post. The worker then updates the job to the canonical Reddit post ID and re-checks the user's completed cache before finalizing quota. This prevents different share tokens for the same post from charging the same user twice once the canonical post is known.

## Existing link expansion included

This cumulative package also includes the previously prepared link expansion that had not yet been deployed at the baseline above:

- Instagram post text extraction
- TikTok photo-post text extraction
- X post extraction through public embed metadata
- generic public HTML/text page extraction
- content classification as `video`, `post`, or `page`
- backward-compatible MCP tool id `get_video_transcript`, while the product-facing tool remains `Read link content`
- `content_text` and `content_type` output while retaining legacy `transcript`
- one equivalent content minute for successful text-only post/page reads
- SSRF-safe generic page fetching and bounded content extraction

## Security / privacy boundaries

- HTTPS only for fetched public content
- DNS/IP validation and redirect-by-redirect checks through the existing safe HTTP layer
- response-size limits and content-type checks
- no private/login-only/paywalled/DRM bypass
- fetched post/page/comment text is explicitly treated as **untrusted source material**, never instructions
- no image OCR or full visual understanding in this update
- no bulk Reddit crawling, profile crawling, subreddit-feed crawling, or comment-pagination crawling

## UI / MCP

- Homepage supported-platform row now includes Reddit.
- FAQ now names Reddit support.
- MCP server version is `1.2.0`.
- MCP description advertises individual public Reddit posts with bounded top public comments.
- Existing connected Claude/OpenAI clients retain the same tool IDs.

## Dev/test hardening included

- `JobRow.platform` and cache types include `reddit`.
- Pure tests cover standard Reddit posts, `redd.it`, gallery URLs, opaque `/s/` share URLs, rejected subreddit/profile URLs, and Reddit JSON/comment parsing.
- `src/util/process.ts` callback types were made explicit for dependency-light TypeScript checking.
- `check/external.d.ts` now declares `randomUUID`, fixing the local dependency-light check stub used by the cumulative analytics source.

Validation performed while packaging:

- `tsc -p tsconfig.check.json --pretty false` — PASS
- `tsc -p tsconfig.pure.json --pretty false` — PASS
- `node test/pure.mjs` — PASS
- ZIP integrity / fresh-overlay validation — performed before delivery

A clean `npm ci` could not complete inside the artifact sandbox because npm registry access is unavailable there. Railway remains the full dependency/build/runtime compile gate after push.

## Deployment

No new Railway environment variable is required.

Production pre-deploy remains:

`npm run db:migrate:prod`

After pushing, verify both API and Worker deploy successfully, then smoke-test at minimum:

1. one standard Reddit comments URL
2. one `redd.it` short URL
3. one Reddit `/s/` mobile share URL
4. one X post
5. one Instagram post
6. one normal public article
7. one existing YouTube/Instagram Reel to ensure media regression safety

## Important

This release intentionally does **not** add Threads, Facebook post extraction, OCR, image understanding, or arbitrary multi-page crawling. Those remain separate future slices.
