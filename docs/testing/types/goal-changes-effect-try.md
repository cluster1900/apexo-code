# BUG-20261014-006: Incorrect Effect.try Signature in Goal Git Path Decoding

- **Status**: Fixed & Verified; **Verified Occurrences**: 3; **Linked Rule**: [RULE-20261015-023](../../rules/effect-try-options.md).
- **Scope**: UTF-8 decoding for Git changed-file lists.
- **Observed**: Typecheck rejected the single-function `Effect.try` overload, and runtime threw `options.catch is not a function` across 5 Git test scenarios.
- **Expected**: Valid UTF-8 paths decode cleanly, while invalid UTF-8 converts into an explicit unavailable-evidence result.
- **Reproduction**: In `packages/apexo`, run `bun typecheck` and `GITHUB_ACTIONS=false bun test test/session/goal-changes.test.ts`.
- **Root Cause**: The pinned Effect v4 beta requires `Effect.try({ try, catch })`; the new code used an older single-function signature.
- **Fix**: Switch both path decoding call sites to explicit `{ try, catch }` options.
- **Verification**: 11 targeted unit tests passed (0 failed) and full-repo typecheck passed 21/21.

## Native Memory extraction parser

The private native Memory draft independently used `Effect.try(() => MemoryCapture.parse(...))`. Core typechecking rejected the unsupported callback overload and consequently inferred an unknown outcome. The correction uses the pinned API's explicit `{ try, catch }` object and preserves the typed failure. No runtime parser failure is claimed for this episode: typechecking caught it first.

After correction, private Core and Apexo package typechecks passed. `bun test test/v2/memory-lifecycle-native.test.ts` from `packages/apexo` passed three tests / 21 assertions, including a real tool-free extractor response parsed by the canonical store. This is a second independent occurrence, below the promotion threshold.

## Native batch Dream response validation

A third independent private draft used the obsolete callback overload in the batch response/parser/action boundaries. The real local provider completed its reply, then runtime threw `options.catch is not a function` and the canonical operation settled failed. Explicit `{ try, catch }` options restored typed validation. The corrected action exchange and 21-note partition both passed with two provider calls each; the expanded batch protocol/native suite also passed its non-automatic cases. Reproduce from `packages/apexo` with `bun test test/v2/memory-batch-dream-native.test.ts test/v2/memory-batch-dream-protocol.test.ts`. This is one independently authored recurrence, not one count per callback or diagnostic rerun.
