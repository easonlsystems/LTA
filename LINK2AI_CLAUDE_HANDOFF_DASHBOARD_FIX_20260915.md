# Link2AI Claude handoff + dashboard fix — 2026-09-15

- Keeps the Link2AI setup tab open while Claude setup runs in a new tab.
- Does not assume the user understands when setup is finished.
- Starts a per-attempt connection watch only after the user clicks “Open Claude setup”.
- Detects a newly issued OAuth token for that setup attempt.
- Shows a “finish setup” state while OAuth is in progress.
- Automatically replaces the setup page with `/account` after the new Claude connection is complete.
- `/account` already shows plan, used minutes, and remaining trial links / subscription controls.
- Avoids treating old OAuth tokens as proof that a new setup attempt just succeeded.
