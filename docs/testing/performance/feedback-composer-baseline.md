# Feedback Draft UI Composer Benchmark

Before changing session/prompt UI for feedback drafts, the existing production Desktop backend + built App renderer benchmark was run from `packages/apexo` with Bun 1.3.14:

```sh
bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only
```

On 2026-10-14, reload-request to first visible composer animation frame samples were 142, 126, 126, 135, 118, 140, 122, 117, 127, and 130 ms. After discarding the first two warmups, median was 126.5 ms and p95 was 140 ms. The harness uses the browser clock and agent-browser. This records compositor readiness, not provider response time. Post-change measurements follow below.

An initial post-change shared build sample, taken while native/browser acceptance was also active, measured 192, 145, 180, 152, 145, 146, 150, 157, 152, and 146 ms (median 151 ms, p95 180 ms after warmups). This is a 24.5 ms median increase relative to the baseline, but the concurrent workload and intervening shared build changes prevent attributing it to the lazy feedback entrypoint. The final sample after the dialog scroll correction, without this agent's concurrent native/browser tests, is recorded below. The dialog itself loads only when opened.

Final isolated post-change sample, after the corrected shared App/Desktop build and after functional fixtures finished: 129, 117, 113, 116, 110, 124, 114, 112, 113, and 114 ms. Median after warmups was 113.5 ms and p95 was 124 ms, versus baseline 126.5/140 ms. The parent held heavy builds/tests during this measurement. This sample shows no observed composer-readiness regression; the earlier concurrent sample remains recorded above rather than discarded. It does not establish a causal speedup, and the measurement does not cover provider latency or feedback dialog-opening time.

## Image attachment extension (2026-10-15)

The approved pre-change production Desktop artifact used source HEAD `3ac66232` plus the shared working tree at the baseline checkpoint. It excluded the latest backend-only Task wake/cancellation changes, but the composer and renderer sources were unchanged. Ten samples were 685, 195, 129, 126, 123, 117, 107, 110, 120 and 126 ms. Excluding the first two warmups gives median 121.5 ms and p95 129 ms.

After the private image-attachment implementation and final production App/Desktop rebuild, samples were 255, 151, 155, 158, 151, 133, 135, 127, 138 and 146 ms: median 142 ms and p95 158 ms after the same two warmups. The full shared unit process had exited, and the other agents held builds/tests during measurement. This is an observed 20.5 ms median and 29 ms p95 increase, not a claimed improvement. A single pair across different source/build checkpoints cannot establish the image dialog as the cause; the attachment dialog remains lazily imported on explicit open, and its code does not enter the initial composer path. No threshold was specified. This measurement covers compositor readiness, not dialog opening or provider latency, and remains a performance observation for follow-up if repeated measurements confirm it.
