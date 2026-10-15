# INVESTIGATION-20261014-005: Composer Display Latency Above Baseline During Report Management Phase

- **Status**: Investigating; no verified performance fix yet.
- **Scope**: Production App connected to the production Electron backend, measuring reload request to first visible composer paint frame.
- **Reproduction Command**: In `packages/apexo`, run `bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only` (10 samples after discarding 2 warmup runs).
- **Observed**:
  - Baseline samples: `[130, 115, 107, 113, 117, 123, 114, 112, 123, 111]` ms (median 113.5 ms, p95 123 ms).
  - Post-change samples: `[193, 151, 137, 163, 186, 196, 164, 152, 200, 159]` ms (median 163.5 ms, p95 200 ms).
  - Subsequent diagnostic runs without product changes measured median 122.5 ms / p95 141 ms (`[128, 138, 119, 115, 126, 126, 118, 128, 141, 117]`) and median 136.5 ms / p95 191 ms (`[215, 123, 191, 173, 162, 116, 134, 117, 139, 121]`), with no `goal-reports` chunk or report API requests while the panel is closed.
- **Expected**: Keeping the Goal report panel closed does not load report chunks, issue background report requests, or regress composer first-paint latency.
- **Root Cause**: Unconfirmed. High host load (6.6–24.7) was observed across runs, causing significant variance on identical builds, but paired low-load baselines are still required before ruling out a code regression.
