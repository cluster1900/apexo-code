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

## External-review remediation comparison

A new production baseline was recorded before this remediation changed App session/composer code. The final production build used the same isolated browser-clock method, with no other acceptance or full gate running during measurement.

| Build | Samples (ms) | Median | Reported p95 |
| --- | --- | --- | --- |
| Before remediation | 202, 173, 183, 589, 169, 167, 181, 181, 227, 612 | 182 ms | 612 ms |
| Final remediation build | 930, 165, 162, 162, 166, 160, 145, 185, 166, 161 | 162 ms | 185 ms |

The final observed median is 20 ms lower (about 11%). The first two samples are warmups and excluded by the existing method, including the final build's 930 ms cold sample. This single comparison does not establish a general tail-latency improvement or resolve the earlier unexplained request delays.

A separate 6279-file review fixture measured twenty ordinary persisted detail reads at 0.623 ms median and 0.902 ms p95. An explicitly requested `compareWorkspace=true` check took 1018 ms and detected a subsequent edit. This separates expensive advisory workspace work from active status polling; it does not claim workspace capture itself is instantaneous. Real mini/fullscreen PTY checks held a passive response and verified that one cancel key still cancels the selected review.
