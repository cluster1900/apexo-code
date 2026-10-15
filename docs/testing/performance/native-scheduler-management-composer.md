# Scheduler management and loop composer measurement

The Scheduler management, ordinary `/loop` admission and Session-owned permission-action UI were measured with the same preserved packaged compatibility backend. This comparison concerns App rendering; functional native acceptance uses the real native backend separately.

The exact before App had already been measured immediately before this slice. Its preserved 1,803 files were hash-verified, including index SHA-256 `ccb2d3cc5522990c0b05aa8820ea291c2636a04dba44881756d1a3890ceccf6b`. The after App index was `9cc7a3825ec21a2a4bc6a27335afa596a1d7e01c5a9524b5fab26b4500d25fc9`. Both runs use backend chunk `node-BtwF42cz.js`, SHA-256 `e0f021eae5a8214986b92a5b8185f18bb7cb8b576e33d6475f3d7f689ceb5cbd`.

The browser clock measures reload request to the first visible composer animation frame. Each run collects ten samples and excludes the first two warmups from its median and p95:

| Artifact | Samples (ms) | Median | p95 | Long Tasks |
| --- | --- | --- | --- | --- |
| Before | 122, 113, 119, 113, 111, 122, 124, 108, 111, 116 | 114.5 ms | 124 ms | 0 |
| First after observation | 141, 117, 129, 129, 123, 114, 117, 124, 126, 143 | 125 ms | 143 ms | 0 |
| Clean after repeat | 148, 125, 123, 123, 119, 126, 117, 109, 126, 117 | 121 ms | 126 ms | 0 |

A baseline-file hash check overlapped startup of the first after run, so that result is retained as an observation and one clean repeat was run after all preflight hashing completed. Other agents held runtime/build/type work during the quiet window. Unrelated host load and the earlier before measurement's host conditions were not controlled. The clean repeat differs by +6.5 ms median and +2 ms p95; these small samples do not establish a causal slowdown or a no-regression guarantee.

Both after commands exited zero and owned fixture processes were reaped. Before files, the after artifact manifest and fixed backend hash were unchanged after the runs. No shared App or Desktop artifact was swapped. The harness is the existing `grok-plugins-ui.mjs desktop --benchmark --benchmark-only` production measurement with an explicit preserved-backend copy and `PAIRED_APP_DIST` override. This timing result does not replace native browser/window, terminal, permission-lifecycle or backend acceptance.
