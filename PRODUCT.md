# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who already use Claude or another compatible AI and encounter public links the AI cannot reliably read. Their immediate job is to bring the real source into the conversation without copying content manually or learning MCP infrastructure.

## Product Purpose

LTA retrieves supported public source content and transports it into the host AI's usable context. Success is a first useful source read inside the user's existing AI conversation, reached with minimal setup friction.

## Positioning

LTA is the source transport layer between a public link and the AI the user already chose. The host AI interprets the returned text or images; LTA is not a separate chatbot and does not claim full visual understanding of video.

Primary tagline: **“Your AI got the link. LTA brings the source.”**

## Operating Context

The primary path is homepage → Claude's prefilled Add Custom Connector flow → OAuth/sign-in only when required → return to Claude → load LTA from Connectors → paste a public link → receive source-grounded context. The activation goal is the first successful source read, not connection alone. Users must not be sent to Claude's generic Connector Directory or through a signup-first wall.

## Capabilities and Constraints

- Public product name: LTA. Compatibility identifiers may retain Link2AI/l2ai.
- Supported routes include YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issues/Pull Requests, Hacker News, readable public webpages, and public text-layer PDFs.
- Reddit is advertised only when approved OAuth credentials are configured.
- Supported social image posts can pass original images to the host AI. Video primarily returns captions, speech, and ASR-derived text; visual-only frames are not understood.
- Private, login-gated, paywalled, DRM, inaccessible, or extraction-failed sources may fail and consume 0 units.
- Trial: 10 units. Basic: $4.99/month for 500 units. Pro: $9.99/month for 2,000 units. Top-ups exist.
- Video uses 1 unit per started processed minute. Text uses roughly 1 unit per 2,500 estimated tokens, minimum 1 on success.

## Brand Commitments

Use the LTA name and existing logo. The public experience should feel immediate, interactive, and product-led. It should catch attention through a believable demonstration users can operate, then turn that understanding into direct Claude connector activation. Preserve honest limitations and the detailed first-use guidance through progressive disclosure.

## Evidence on Hand

- A recorded real Instagram Reel test case identified in the homepage implementation (`Ddx6Q_MJNyg`).
- Existing Claude connector setup screenshots under `assets/tutorial/`.
- Working direct Claude Custom Connector URL with the product name and MCP URL prefilled.
- Production source, pricing, quota, and reliability behavior implemented in the repository.
- No fabricated testimonials, customer logos, or unsupported performance claims may be introduced.

## Product Principles

1. Demonstrate the source-access gap before explaining infrastructure.
2. Let visitors interact with the product story immediately.
3. Convert understanding into the direct Claude connector flow without signup friction.
4. Keep capability and limitation claims tied to runtime truth.
5. Preserve useful setup help through progressive disclosure rather than removing it.

## Accessibility & Inclusion

Core interactions must work by keyboard, expose state changes to assistive technology, preserve readable contrast, and respect reduced-motion preferences. Mobile visitors must receive the same product understanding and activation path without horizontal page overflow.
