# Security and data-handling notes

Link2AI accepts public URLs supplied by users and interacts with multiple external systems. The V1 design therefore treats URL fetching, authentication, billing, and third-party content as explicit trust boundaries.

## URL / SSRF boundary

Supported platform hosts are allowlisted. URL handling re-validates redirects and resolved IP addresses to reject localhost, private, link-local, and other unsafe destinations.

The same safe-fetch rules are applied to externally supplied caption URLs and remote client metadata where applicable.

## OAuth boundary

The MCP service uses authorization code flow with PKCE S256. Access tokens are bound to the MCP resource, and refresh tokens support long-lived AI-client connections. Revocation is supported.

Both Client ID Metadata Documents and Dynamic Client Registration are supported for client compatibility, with validation and abuse controls around remote metadata / registration.

## Browser actions

Account and billing actions use session-bound CSRF validation. Email login codes are generated with cryptographic randomness and compared using timing-safe verification.

## Content boundary

Video transcripts are third-party, untrusted content. Tool output marks transcript/caption text as data rather than trusted instructions so Link2AI does not intentionally elevate prompt-injection content.

## Error boundary

Internal exceptions are mapped to structured public errors. Database connection strings, file paths, provider internals, and raw process errors are not intentionally returned through MCP.

## Retention

- raw media: not intentionally retained
- temporary normalized audio: removed after processing/failure
- transcript cache: expires automatically (72 h by default)
- expired jobs: media URL / canonical identity are scrubbed after retention cleanup
- account, OAuth, billing and usage records: retained as needed to operate the service

Worker startup and periodic maintenance also remove stale temporary directories left behind by terminated processes.

## V1 policy boundary

Link2AI does not intentionally bypass:

- private accounts
- login-only media
- DRM / paid content
- access controls

The service processes user-requested public URLs only.
