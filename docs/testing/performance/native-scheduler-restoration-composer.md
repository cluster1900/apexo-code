# Explicit Scheduler restoration composer measurement

This scoped comparison covers the explicit Session-restoration callers, existing Tasks manager action and localized outcomes. It uses the same preserved compatibility Desktop backend for both App artifacts; native Scheduler backend startup is not part of this measurement.

The fresh restoration checkpoint's entire App source tree matched the preceding UI49 source before restoration edits. Its already measured production artifact therefore supplies the before sample. The after sample was captured after private App/Desktop builds, with coordinated agent runtime/type/build jobs idle. Neither sample establishes causation or a general performance guarantee.

| Artifact                         | SHA256                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| Before App index                 | `9cc7a3825ec21a2a4bc6a27335afa596a1d7e01c5a9524b5fab26b4500d25fc9` |
| After App index                  | `ac6855e68d0af04dd5826ab28ad131b3dbfbc887c7cb0c3cfa91cd20e50eddfc` |
| Fixed backend `node-BtwF42cz.js` | `e0f021eae5a8214986b92a5b8185f18bb7cb8b576e33d6475f3d7f689ceb5cbd` |

All three hashes were checked after the run and remained unchanged. Browser resource diagnostics confirmed the after renderer loaded `index-VPfcHGuL.js` and `index-CSv1Lw8I.css` from its production artifact. Shared App/Desktop artifacts were not swapped.

The existing real-browser benchmark measures browser-clock reload request to the first visible composer animation frame. It records ten samples and excludes the first two warm-up samples for the reported median and p95 (the maximum of the remaining eight).

| Sample | Raw milliseconds                                 | Median   | p95    | Long Tasks across all ten |
| ------ | ------------------------------------------------ | -------- | ------ | ------------------------- |
| Before | 148, 125, 123, 123, 119, 126, 117, 109, 126, 117 | 121 ms   | 126 ms | 0                         |
| After  | 229, 111, 116, 133, 120, 114, 115, 105, 111, 114 | 114.5 ms | 133 ms | 0                         |

The observed median decreased 6.5 ms and the observed p95 increased 7 ms. The first after warm-up was 229 ms and is retained in the raw series. Coordinating agent jobs does not control all host activity, cache effects or scheduling variation, so this is a scoped observation, not proof of improvement or regression.

Functional restoration acceptance is recorded separately in [Explicit Session restoration](../../native-scheduler-restoration.md). The private benchmark harness reused `grok-plugins-ui.mjs desktop --benchmark --benchmark-only` with its fixed-backend fixture and an explicit after-App distribution override. All owned benchmark processes were reaped.
