# Native Process manager composer comparison

This is a local production-artifact comparison, not a bug occurrence or a general Desktop performance guarantee. The before artifact is the accepted Plan/media UI measured immediately before the Process manager changes; its exact 1,810 preserved App/Desktop file hashes were revalidated. Both measurements use the same preserved backend and the same isolated ten-sample composer harness described in [the earlier measurement](native-media-plan-composer.md). No shared artifacts were swapped.

| Artifact | Raw milliseconds | Median after two warmups | p95 | Long Tasks |
| --- | --- | --- | --- | --- |
| Before Process manager | 132,116,108,105,113,126,124,113,106,108 | 110.5 | 126 | 0 |
| Integrated Process manager | 129,124,120,118,127,111,122,113,109,110 | 115.5 | 127 | 0 |

The clock runs from requested browser reload to the first visible composer animation frame. Root and all three agents confirmed no active build, typecheck, runtime test or source-copy job during the after sample. Unrelated host activity remains uncontrolled. The after command exited zero and its owned processes were reaped. All ten navigation, resource and Long Task diagnostics were retained.

Before App index SHA-256: `8b13575127f2e206f953313c81773700dbdaf7c9ac01dde725b57696f14ed453`.
After App index SHA-256: `2adf29519b9c00210a631d7a8b3d242828f604a92729d6621ef2abce76968e94`.
Fixed backend chunk SHA-256: `e0f021eae5a8214986b92a5b8185f18bb7cb8b576e33d6475f3d7f689ceb5cbd`.

The observed median difference is five milliseconds and p95 differs by one millisecond. These small samples do not establish a causal slowdown or speedup. The fixture uses the same compatibility Session composer for comparability; native Process listing and real-window behavior have separate functional acceptance in [the feature record](../../native-shell-ui.md). This measurement does not claim native Process polling latency, full startup performance or other-platform acceptance.
