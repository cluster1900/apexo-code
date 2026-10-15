# Side-question UI composer benchmark

The immediate pre-change production baseline is the final isolated feedback sample: 113.5 ms median and 124 ms p95 after discarding two warmups. See [feedback baseline](feedback-composer-baseline.md).

Run from `packages/apexo` with pinned Bun 1.3.14:

```sh
bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only
```

The first final-artifact sample measured 148, 124, 173, 152, 167, 183, 175, 179, 167, and 165 ms; median after warmups was 170 ms and p95 was 183 ms. Although the coordinator initially reported an exclusive window, another agent subsequently confirmed four already-active verification runs (unit, CLI, installed reference, and typecheck). Therefore this sample is concurrent and not comparable with the isolated baseline. It cannot establish a side-question performance regression or its cause. Browser diagnostics showed no long tasks or side-question dialog resources during composer loading. Host one-minute load was approximately 6.55–6.59; this alone does not identify the source of delay.

After all agents explicitly confirmed their verification handles had exited, the unchanged artifacts measured 126, 113, 117, 118, 103, 111, 118, 106, 109, and 105 ms. Median after two warmups was 110 ms and p95 was 118 ms, versus the pre-change baseline of 113.5/124 ms. This shows no observed composer-readiness regression in the isolated sample; it does not establish a causal speedup. No production changes were made between the concurrent and isolated runs. This benchmark does not measure provider latency or side-panel opening time.
