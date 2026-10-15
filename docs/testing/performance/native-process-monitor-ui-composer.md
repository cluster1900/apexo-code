# Native Monitor and terminal Process manager composer comparison

The before and after production App artifacts used the same preserved Desktop backend and isolated ten-sample browser harness. The clock measures requested reload to the first visible composer animation frame. This is a bounded artifact comparison, not a bug occurrence or a complete Desktop performance guarantee.

| Artifact | Raw milliseconds | Median after two warmups | p95 | Long Tasks |
| --- | --- | --- | --- | --- |
| Before Monitor manager integration | 143,126,133,148,128,123,143,132,130,136 | 132.5 | 148 | 0 |
| Integrated Monitor manager | 122,113,119,113,111,122,124,108,111,116 | 114.5 | 124 | 0 |

Before App index SHA-256: `e0250a62ba0e25a68558082545e8d54ab91263cd297ecd4c8abc970c45828ebf`.
After App index SHA-256: `ccb2d3cc5522990c0b05aa8820ea291c2636a04dba44881756d1a3890ceccf6b`.
Fixed backend chunk SHA-256: `e0f021eae5a8214986b92a5b8185f18bb7cb8b576e33d6475f3d7f689ceb5cbd`.

Both commands exited zero and their owned processes were reaped. All ten navigation, resource and Long Task diagnostics were retained for each artifact. Host load and concurrent independent development were not controlled: the first load sample was approximately 11.65 before and 9.40 after. The observed median and p95 are lower, but these samples do not establish a causal speedup or rule out regressions outside this fixture. The same compatibility composer preserves comparability with earlier measurements; actual native Monitor rendering, passive wait and cancellation have separate functional acceptance in [the feature record](../../native-process-monitor-manager.md).
