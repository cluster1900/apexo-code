# Structured review production composer comparison

Scope: F01's prompt action registration and shared session diff preview. Production builds were measured before changing the App session/composer surfaces and after the final interface changes. Existing user app/server processes were not restarted.

## Method

1. Build `packages/app` with `bun run build`.
2. From `packages/apexo`, run `bun script/grok-plugins-ui.mjs cli --benchmark --benchmark-only` against its isolated backend and real Chrome session.
3. Collect ten browser-clock reload-to-first-visible-composer samples. The existing script discards two warmups and reports the median and maximum of the remaining eight as p95.

| Build | Samples (ms) | Median | Reported p95 |
| --- | --- | --- | --- |
| Before F01 presentation | 187, 193, 195, 178, 190, 169, 168, 168, 172, 171 | 171.5 ms | 195 ms |
| First presentation comparison | 190, 173, 180, 187, 196, 182, 178, 192, 662, 165 | 184.5 ms | 662 ms |
| Final presentation and diff-selection fix | 245, 168, 174, 190, 183, 173, 333, 916, 188, 913 | 189 ms | 916 ms |

The final median increased by 17.5 ms (about 10.2%). The observed tail also increased; it is not claimed to be unchanged or fixed. Diagnostics recorded no browser long tasks in the slow samples. The 916/913 ms samples coincided with many backend/static requests taking roughly 335–452 ms; this establishes correlated request delays, not their root cause. No unrelated scheduler/network optimization was added to F01, and these samples remain part of the review evidence.

The new review dialog and its existing diff panel are loaded only when opened. Ordinary composer rendering does not poll review endpoints. Separate browser and rebuilt Desktop acceptance verifies the actual report preview, controlled line highlight, outside-hunk snippet and stale workspace behavior.
