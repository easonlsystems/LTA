# LTA — OpenAI release notes

Initial public OpenAI Plugin Directory submission.

This ChatGPT-specific release of LTA reads exact public GitHub Issues and pull requests only from repositories whose GitHub-detected SPDX license is `CC0-1.0`, `0BSD`, or `Unlicense`. LTA verifies the repository license before creating or reusing a ChatGPT read job and returns the verified SPDX identifier with successful source results.

The release includes:
- OAuth authentication;
- one-link and multi-link GitHub reading;
- long-source continuation;
- source search with `find_in_link`;
- source identity and completeness metadata;
- a fail-closed repository-license rights gate;
- ChatGPT general-audience content safeguards;
- usage tracking with no in-ChatGPT checkout or digital-credit promotion;
- a dedicated reviewer account for testing.

Other LTA distributions may support additional public-link source types and repository licenses; those are not exposed through `/mcp/openai` in this submission.
