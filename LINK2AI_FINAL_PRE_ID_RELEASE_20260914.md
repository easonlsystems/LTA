# Link2AI final pre-ID release — 2026-09-14

Cumulative source update based on deployed `d73cb4d` launch hotfix.

Adds:
- browser-bound founding-beta guest sign-in (`Continue free`) so public beta does not require an outbound email domain
- email OTP gated behind `PUBLIC_EMAIL_LOGIN_ENABLED`
- reviewer credential path retained for OpenAI review
- support page and support URL
- Link2AI listing logo assets
- visual Claude connector onboarding for AI beginners
- privacy/terms updates for guest trial/browser token
- OpenAI submission fields for Universal MCP, no custom UI/CSP domains, global availability
- runtime smoke coverage for support, logo, sitemap, guest-first login

Production env expected on API:
- `PUBLIC_EMAIL_LOGIN_ENABLED=false`
- `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` configured privately
- `OPENAI_APPS_CHALLENGE` only after the submission portal provides the token

Validation before packaging:
- TypeScript pure subset: PASS
- pure regression tests: PASS
- syntax/transpile checks for edited TypeScript: PASS
- full build/runtime smoke could not be completed in the assistant container because its local `node_modules` is incomplete and external npm access is unavailable. Railway is the authoritative full production build after push.
