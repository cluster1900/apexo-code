# Native Task UI composer measurement

The Task polling helper is used by the Session composer even though neither prompt-input implementation changed. A production baseline was captured before editing and compared with the private production App build afterward. All participating agents confirmed their runtime/build/type jobs were idle during both measurements.

Run from `packages/apexo` with pinned Bun 1.3.14:

```sh
bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only
```

The fixture reports browser-clock time from requested reload to the first visible composer animation frame through agent-browser. Ten samples were captured, with the first two excluded as warmups. This is a small local timing sample, not a broad performance guarantee.

| Variant | Raw samples, ms | Median | p95 |
| --- | --- | --- | --- |
| Before Task UI changes | 127, 117, 115, 114, 120, 124, 115, 112, 107, 116 | 115 | 124 |
| Private production App after | 122, 123, 122, 113, 114, 110, 116, 113, 105, 116 | 113.5 | 122 |

The entire packaged backend tree was copied before editing and verified byte-for-byte after the paired run. Its loaded `node-BgpdI9KN.js` chunk SHA-256 was `175b97d1cb5d22d518266b359fab5ec722ee3647987b3253250105d12673e9ae` in both runs. The before App `index.html` SHA-256 was `15c3c47502924c9c6705942811ee742389775d7f3f6d882a837a9310209d0819`; the after App value was `3ab94f0c634473bc783709606a425a1975a5b800f6d272bbbf98721e98f1e7ec`.

No regression is visible in this sample. Both commands exited successfully and their owned browser/server processes were reaped. The native Task server used for behavior acceptance is separate from this deliberately fixed compatibility backend. Later terminal-only row-budget changes do not alter the measured App artifact.


The integrated UI passed live adapter, typecheck, native-window and narrow PTY gates. The later shared-artifact composer run measured median 111 ms and p95 118 ms, but its backend differs from the paired measurement above. It is a separate baseline for the following sandbox UI batch, not evidence of a Task-caused speedup.

## Background Task adapter and mode marker

A separate fixed-backend comparison covers the background summary adapter, recent-task description and conditional row marker. The pre-edit production artifact is the accepted post-BUG095 private App checkpoint. Only the five App files from the background backend handoff and four App files from the row-marker handoff were applied to that same private source checkpoint; unrelated sources and dependency identities were preserved.

The fixed backend chunk `node-D8uxO9m1.js` retained SHA-256 `f3e7fca24d926736e9298da0267d0b3baa85145db75dedb6a802fd06fc92acf7`. Before App index SHA-256 was `fa29b4f37fa9727ba99c0da8db8a03949effb979ed90a27e6e44cdd00eca2179`; after was `7ec859743d456e84f7dfef601a434de51826a22d2394f71ab84613cb40c69a97`.

| Sample | Raw samples, ms | Median | p95 |
| --- | --- | --- | --- |
| Recorded pre-edit baseline | 129, 118, 109, 116, 118, 118, 111, 108, 113, 112 | 112.5 | 118 |
| First background UI sample | 138, 118, 115, 111, 114, 136, 107, 115, 112, 120 | 114.5 | 136 |
| Fresh paired before | 127, 126, 127, 122, 127, 134, 116, 112, 124, 118 | 123 | 134 |
| Fresh paired after | 134, 121, 113, 114, 120, 126, 124, 117, 115, 113 | 116 | 126 |

The first sample had a higher tail than the earlier baseline, so one fresh consecutive before/after pair was run to investigate that difference. The difference did not persist in the fresh pair; these small samples do not establish a causal slowdown or speedup. Each excludes its first two warmups. All three new runs had zero Long Task entries. Agents held test/build/runtime work during measurement, although unrelated host load still varied. All benchmark processes exited successfully and were reaped. All 1,810 preserved current App/Desktop artifact files were restored and hash-verified after both staging operations. No product timing change or retry was introduced to improve the measurement.
