# Native media and Plan UI composer measurement

Before either isolated media presentation or Plan Question-dock edit, the current accepted Task UI production build was measured with `bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only` from `packages/apexo` using pinned Bun1.3.14. All three agents confirmed no active build/type/runtime job during this baseline. Unrelated host activity remains outside the fixture's control.

The browser-clock measurement runs from requested reload to the first visible composer animation frame. Raw milliseconds: **124, 122, 127, 107, 113, 119, 114, 109, 130, 107**. Excluding two warmups gives median **113.5 ms**, p95 **130 ms**. No Long Task entries were observed. The command exited0 and its owned processes were reaped. This is a local ten-sample baseline, not a performance guarantee.

The complete App/Desktop artifacts were preserved for fixed-backend per-slice comparison. App index SHA-256: `83ecb90635db3a9eec370caef7fc45b7d52852ec875ce0b75a654d8fe0c0b661`. Desktop `node-BtwF42cz.js` SHA-256: `e0f021eae5a8214986b92a5b8185f18bb7cb8b576e33d6475f3d7f689ceb5cbd`.

## Fixed-backend integrated comparisons

Both later runs use the exact preserved backend above. An isolated copy of the
benchmark harness changes only the resolved repository/artifact locations; the
shared source and built artifacts are not swapped. The preserved backend uses
its original Desktop external dependency tree (see BUG135). The Plan-only App
artifact was built and preserved before integrating media; the second artifact
contains Plan plus media. Agents held builds, runtime tests and source copying
during both measurements. Unrelated host activity remains uncontrolled.

| Artifact | Raw milliseconds | Median after two warmups | p95 | Long Tasks |
| --- | --- | --- | --- | --- |
| Original accepted UI | 124,122,127,107,113,119,114,109,130,107 | 113.5 | 130 | 0 |
| Integrated Plan UI | 126,119,115,112,118,116,114,112,113,115 | 114.5 | 118 | 0 |
| Integrated Plan + media UI | 132,116,108,105,113,126,124,113,106,108 | 110.5 | 126 | 0 |

Plan-only App index SHA-256:
`69d9ba4d4b8fd70186bfc91e814a02e0a88a2a26420e0ce049b9ad4d14f226f0`.
Plan + media index:
`8b13575127f2e206f953313c81773700dbdaf7c9ac01dde725b57696f14ed453`.
All 1,810 preserved baseline artifact files retain their original hashes. Both
runs exited zero and their owned processes were reaped; each has ten browser
navigation/paint/resource/Long Task diagnostics. The failed initial external
module lookup produced no measurement and is excluded. These small local samples
do not establish a causal speedup, slowdown or latency guarantee. Native media
playback acceptance remains a separate functional gate.

