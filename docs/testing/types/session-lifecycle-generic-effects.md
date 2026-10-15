# BUG-20261015-005: Lifecycle generic branches widened or narrowed the wrong Effect channel

- **Scope:** New off-tree generic lifecycle ownership helpers.
- **Observed:** Initial typechecking rejected a conditional `Effect.suspend` branch and a failed registration branch in the generic long-running ownership helper.
- **Expected:** Helpers preserve success `A`, error `E | SessionLifecycle.Closed`, and environment `R` without adding a release callback to successful results.
- **Root cause:** Conditional generic Effect inference selected the failure-only branch's error type; yielding an entire failed registration Exit also exposed the registration's success type to the outer generic function.
- **Fix:** Express the conditional branch through the generator and propagate the registration failure with `Effect.failCause`, after joining the blocked worker. Do not cast away the channel mismatch.
- **Reproduction:** Run `bun typecheck` from `packages/core` in the earlier isolated draft.
- **Verification:** Core and Apexo package typechecks passed after the fixes. Focused lifecycle tests verify registration interruption, ownership release and cancellation. Verification is draft-only.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).

## Hook preference draft occurrence

The new durable preference store exposed the same conditional Effect inference boundary: its missing-document and decoded-document branches inferred incompatible success/error channels, while a conditional snapshot `saved` branch selected a narrower failure channel. The store now declares the genuinely generic result boundary explicitly and the accessor uses a generator. The public Core typecheck passed. This is a second independent implementation occurrence; the threshold for a recurring rule has not been reached. No runtime behavior was inferred from the compiler failure.

Live Hook-preference integration passed all twenty-one repository typecheck tasks after the second correction.

## Native media draft occurrence

The exact output-candidate permission preflight returned a conditional `Effect.fail(ToolFailure)` or a permission effect from `Effect.flatMap`. Type inference selected the narrower failure channel and rejected the permission error union (TS2322), then produced downstream unknown target/environment diagnostics. This was one implementation episode, independent of the Lifecycle and Hook-preference cases. Expressing the branch with `Effect.gen` preserved the actual success/error channels without casts. Core package typechecking passed after the correction. The final frozen media runtime gate passed 14 tests / 104 assertions after the generator rewrite; CLI acceptance passed five checks / eight language-provider requests.

Three independent conditional-channel episodes are now documented. Follow [RULE-20261015-008](../../rules/conditional-effect-channel-inference.md).

## Independent Memory fixture occurrence

The Memory HTTP fixture selected between raw pure-native and mixed Layers with different requirements without a checked boundary. A second site combined `Effect<Snapshot, ...>` and `Effect<Summary[], ...>` values before `Effect.result`. Apexo typechecking rejected those conditional generic channels and emitted dependent `unknown` / `never` diagnostics. These are two sites in one Memory fixture-authoring episode, not two independent recurrences.

The fixture now declares the real mixed-host `Layer<never, ConfigError, HttpServer>` boundary, supplies each host before selection, and maps unused success values to `void` before building its failure-only assertion array. There are no casts or discarded failures. `bun typecheck` in `packages/apexo` passed; the final focused Memory gate passed 36 tests / 229 assertions, including the pure-native and mixed HTTP cases (2 / 36).

Four independent conditional-channel episodes are documented. RULE-20261015-008 continues to apply. This inference issue is separate from BUG-20261015-133's missing production error-union member.

## Independent native Dream/migration controller occurrence

The Stage 2 controller's Location callback returned either a capture Plan Effect or a MigrationPlan Effect. The latter permits a legacy backend, while the first branch fixed it to V2. Conditional inference selected the narrower success channel and produced TS2322 plus downstream `unknown` environment/plan diagnostics. Rewriting the selection as an Effect generator preserves each real branch without a cast. Core and Apexo package typechecks passed after the change.

This is the fifth independent conditional-channel episode, separate from the earlier Memory HTTP fixture. [RULE-20261015-008](../../rules/conditional-effect-channel-inference.md) remains the same constraint; no new rule is created.

## Independent native legacy flush controller occurrence

The legacy flush admission branch returned a Legacy Plan Effect beside a V2 capture Plan Effect in one callback. Conditional inference selected the V2-only channel and produced TS2322 plus dependent `unknown` diagnostics in SessionMemoryOperation. The selection now uses a generator, preserving both discriminated plans and their actual errors without a cast. Core and Apexo package `bun typecheck` passed, and the legacy focused suite passed 8 tests / 45 assertions.

This is a sixth independent conditional-channel episode. [RULE-20261015-008](../../rules/conditional-effect-channel-inference.md) still supplies the same constraint; no new rule is created. A separate untyped configuration accumulator in the same authoring run was fixed with the canonical ConfigMemory.Flush type, and is not counted as another occurrence.

## Independent Feedback image snapshot occurrence

The first Feedback image store draft returned either an existing image-reference Effect or a decoded snapshot Effect directly from `Effect.forEach`. Type inference fixed the first success shape and rejected the second, then widened dependent transaction values to `unknown`. The callbacks now use generators so both discriminated values and their actual errors remain in the inferred channel. No casts or discarded failures were added. `bun typecheck` from `packages/core` passed; the focused Feedback store/native/compat HTTP suite passed 17 tests / 125 assertions.

This is the seventh independent conditional-channel episode. [RULE-20261015-008](../../rules/conditional-effect-channel-inference.md) remains the applicable constraint.
