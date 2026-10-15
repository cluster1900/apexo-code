# Command sandbox UI composer measurement

The App Session controls and native prompt adapter were measured with production App artifacts against exactly the same preserved Desktop backend. Participating agents held runtime, build and typecheck jobs during both runs. This fixture measures requested reload to the first visible composer animation frame through agent-browser; it does not measure prompt/model latency.

From `packages/apexo`, pinned Bun 1.3.14:

```sh
bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only
```

Ten samples were captured; the first two are warmups and are excluded from reported statistics.

| Artifact | Raw samples, ms | Median | p95 |
| --- | --- | --- | --- |
| Before sandbox UI | 123, 116, 112, 110, 113, 112, 106, 107, 109, 118 | 111 | 118 |
| Final private production App | 131, 119, 112, 113, 112, 124, 120, 125, 124, 126 | 122 | 126 |

The observed median increased 11 ms and p95 increased 8 ms. This small local sample does not establish a cause or a general performance guarantee; no claim of zero regression or speedup is made. The dialog is lazy-loaded and status requests start when opened. Further attribution requires a controlled profile, not a guessed fix.

All preserved Desktop main files matched their baseline hashes before and after. Its loaded `node-D8uxO9m1.js` SHA-256 was `f3e7fca24d926736e9298da0267d0b3baa85145db75dedb6a802fd06fc92acf7` in both runs. The before App index SHA-256 was `7a12c9e1c5a293e52e76233ed12c4ff2b692bd37e1413001c2523b09b341148c`; final private App was `4543ebeaf543dfca4a06811813d8e06e5fcc4fdb0b1934384d8c0aa156a1b665`. Both commands exited zero and owned processes were reaped. The preserved shared artifacts were restored after the measurement.

An intermediate after run measured 114.5/120 ms before the final attachment-span adapter correction. It is retained only as intermediate evidence and is not substituted for the final artifact's result. Behavioral acceptance uses the rebuilt current backend separately from this fixed comparison backend.

## Creation-error repair follow-up

After the narrow BUG095 early return, the same private source/dependency snapshot was rebuilt. Its production App index SHA-256 is `fa29b4f37fa9727ba99c0da8db8a03949effb979ed90a27e6e44cdd00eca2179`. It was measured against the exact same preserved Desktop backend above, after every agent's runtime/build/typecheck job had finished. Both App source versions matched the shared source at their respective checkpoints; their private lock and dependency tree stayed fixed.

Raw samples were 129, 118, 109, 116, 118, 118, 111, 108, 113, 112 ms. Excluding the first two warmups gives **112.5 ms median / 118 ms p95**, compared with the pre-repair artifact's 122 / 126 ms. No Long Task entries were observed. This sample shows no observed increase for the repair; it does not establish a causal speedup or resolve the cause of earlier sample variation. The original pre-feature baseline was 111 / 118 ms.

The benchmark exited zero and its owned processes were reaped. All fixed-backend files matched before restoration, and all 1,810 preserved current production App/Desktop artifact files matched their saved SHA-256 values after restoration. Behavioral acceptance separately uses the current rebuilt backend.
