# BUG-20261015-166: Initial mixed-server mini attachment did not reach its pending Question

- **Scope:** First explicit native selection on the real mixed server; one observed episode.
- **Observed:** The backend had printed its listening address and admitted a native prompt. The terminal displayed its header but did not render the pending ordinary Question within the unchanged 30-second fixture poll. The run failed and owned cleanup completed.
- **Expected:** Native history and the existing Question become visible without another provider call.
- **Reproduction:** Run the initial `grok-native-terminal-tui.mjs --mixed` fixture from `packages/apexo` without the later diagnostic forwarding recorder.
- **Cause:** Unknown. Header-only output does not identify a specific blocked operation. This is distinct from backend readiness failures that occur before a listening address or PTY.
- **Investigation:** A transparent recorder was added to observe exact requests. Its own fixture defects are recorded separately in BUG167. With the corrected recorder, actual mini and fullscreen interactions passed and requests remained native. Changing the observation transport is not proof that the original direct-path timing failure was fixed.
- **Status:** Original direct-path timing remains unresolved; no production fix or recurrence count is claimed. The feature document distinguishes completed acceptance from this retained limitation.

## Later fresh-session observation

The recorded mixed-server mini fresh-session fixture also once failed its unchanged 30-second terminal-readiness poll. Its recorder showed successful catalog reads and native Session creation, while the terminal footer remained blank. The unchanged command passed when run again serially: two checks, two provider calls, one correctly placed Session and the expected native user message. This is a second observation retained in the same investigation, not a second verified occurrence of a known root cause. No timeout was increased and no production repair is claimed. Fullscreen fresh creation passed separately.

Verification: from `packages/apexo`, `bun script/grok-native-terminal-fresh.mjs --mixed` (one failed observation, then unchanged passing run) and `bun script/grok-native-terminal-fresh.mjs --mixed --fullscreen` (passed).
