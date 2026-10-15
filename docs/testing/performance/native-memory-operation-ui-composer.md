# Native Memory operations production composer comparison

This is a small-sample performance observation, not a bug occurrence or proof of a causal speed change.

The final paired run used the same preserved Desktop backend bundle, SHA-256 `1c6430383343e2f69421a97fe26d14cc48c93d86114baede0ac3269b6767308a`, with the identical browser harness and isolated fixture profiles. The baseline App index hash is `e0121476c2fa0093e9c6ec0c42128e83ee6a0605620d98c924f07f11abf82ca0`; the final App index hash is `64245aaca70cac31074087155b587e76fcbe64ef714a161cd483218db6d4ed4f`. The private artifact swap and backend hashes were verified, and no source build or other acceptance workload ran during measurement.

From `packages/apexo`, both commands used `bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only`. The App artifact was the only changed input. Each run collects ten reload-to-visible-composer animation-frame samples, discards the first two for summary statistics, and reports the maximum of the remaining eight as its small-sample p95. This is browser rendering time, not model latency or native-window startup time.

| Artifact | Samples | Median | Reported p95 | Long tasks |
| --- | --- | --- | --- | --- |
| Baseline before operations UI | 10 | 116.5 ms | 125 ms | 0 |
| Final operations UI | 10 | 123 ms | 129 ms | 0 |

The observed difference is +6.5 ms median (+5.58%) and +4 ms reported p95. A shared development host and eight retained samples do not establish a causal regression or improvement. Navigation/resource timings and host load are retained with the artifacts. Both commands exited zero and joined their owned processes; the final App artifact was restored.

Earlier historical measurements (118.5/130 ms before and 121.5/133 ms after) remain preserved in the review handoff. The resumed work initially inherited an incorrect backend hash from an earlier Memory UI performance report. The fresh pair above replaces that ambiguous comparison for the final claim; it uses only the byte-verified backend identified here.
