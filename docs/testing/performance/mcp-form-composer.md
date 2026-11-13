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

## Audit repair comparison (2026-11-13)

A fresh production baseline was recorded before changing Session/composer code for the audit fixes. The final comparison ran after all five local gates, builds and UI acceptance processes finished, using the same command and method.

| Build         | All ten samples (ms)                              | Median after warmups | Reported p95 |
| ------------- | ------------------------------------------------- | -------------------- | ------------ |
| Before repair | 194, 175, 1024, 198, 965, 194, 172, 168, 179, 184 | 189 ms               | 1024 ms      |
| After repair  | 287, 195, 189, 172, 289, 885, 162, 167, 186, 525  | 187.5 ms             | 885 ms       |

The median changed by -1.5 ms (about -0.8%). This fixture shows no observed regression; the variable tail and single comparison do not establish a general improvement. Hydration now queries the viewed root once per polling cycle and discovers descendants through existing live Location scopes and authoritative Session ancestry. No user app or backend was restarted for measurement.
