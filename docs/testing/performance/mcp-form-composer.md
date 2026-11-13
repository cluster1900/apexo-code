# F04 production composer comparison

Scope: Native MCP form hydration in App/Desktop's existing Session composer. A production baseline was measured before editing the session UI, using an isolated backend and Chrome session. No user app/server process was restarted.

## Method

1. Build `packages/app` with `bun run build`.
2. From `packages/apexo`, run `bun script/grok-plugins-ui.mjs cli --benchmark --benchmark-only`.
3. Keep all ten browser-clock reload-to-visible-composer samples. The existing script excludes its first two warmups and reports the maximum of the remaining eight as p95.
4. Run the final comparison after acceptance and complete gates exit, so their load does not overlap the samples.

| Build         | Samples (ms)                                     | Median | Reported p95 |
| ------------- | ------------------------------------------------ | ------ | ------------ |
| Before F04 UI | 195, 248, 185, 285, 972, 180, 169, 572, 181, 265 | 225 ms | 972 ms       |

The observed median decreased by 29 ms (about 12.9%). The measured tail remains variable; one comparison does not establish a general latency improvement. Both runs used the same isolated method, and final acceptance/build processes had exited before measurement. The feature polls only the currently viewed Session family, preserves request identity/drafts across successful hydration, stops unsupported Session scopes, and bounds each hydration read. The benchmark alone does not prove cancellation, scope isolation or field correctness; those are verified separately by API, runner and real UI fixtures.
