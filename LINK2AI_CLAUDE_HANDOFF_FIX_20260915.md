# Link2AI Claude handoff fix — 2026-09-15

Fixes a beginner onboarding dead-end discovered during dogfooding.

- The **Continue in Claude** CTA now navigates in the same browser tab instead of opening a second tab.
- Users are no longer left staring at `/connect` after finishing connector setup in Claude.
- Runtime smoke expectations now match the current Claude `connectorName` / `connectorUrl` install-link parameters.

Baseline: production commit `547301f84df33cea49132237bfa615c8417ba50b`.
