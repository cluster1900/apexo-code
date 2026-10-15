# BUG-20261014-117: Unbranded Model IDs in the Readiness Test

- **Scope:** Native model, project, Workflow effort and Session restoration test fixtures; no production behavior changed.
- **Occurrences:** Five independent fixture episodes involving branded values and typed assertions.
- **Status:** First four occurrences integrated and verified; the fifth private fixture correction awaits integration; the latest shared restoration gate passes18/181 and all21 workspace typechecks pass. See [RULE-20261015-003](../../rules/branded-fixture-values.md).

The new regression passed at runtime but `bun typecheck` from `packages/apexo` rejected a plain string passed to native Session model selection, and a branded LLM ID compared against a string through the typed assertion overload. The fixture must use the model schema's constructor for admission and compare the resolved ID's string value for the assertion.

The fix uses `ModelV2.ID.make` and `String(resolved.id)`. This is distinct from an invalid Workflow ID format: these values were valid strings but lacked the required static brands. No production schema is weakened.

Verification: the prior runtime regression passed seven tests/104 assertions. `bun typecheck` from `packages/apexo` passed after the brand correction; the focused regression passed seven tests and 104 assertions. At that first occurrence, no recurring constraint was warranted.

## Second occurrence: branded project directory assertion

The native project HTTP fixture passed at runtime but its first Apexo typecheck rejected `expect(session.data.location.directory).toBe(instance.directory)`: the actual value is branded `AbsolutePath`, while the fixture exposes a plain string. This repeats the typed-assertion part of the original brand mismatch. The assertion now constructs the expected value with `AbsolutePath.make`; production schemas and values are unchanged. The corrected `bun typecheck` from `packages/apexo` passed. At that second occurrence, no recurring rule was warranted.

## Third occurrence: Workflow effort variant assertions

The new effort-selection tests passed at runtime, but the first private Apexo typecheck rejected plain expected strings in assertions against branded `Model.VariantID` values (`TS2769`). The fixture now uses `Model.VariantID.make` for expected values. This repeats the typed-assertion cause from the earlier model and project fixtures; it does not change production model semantics or remove brands.

Verification in the isolated implementation copy: `bun test test/workflow/effort.test.ts test/workflow/script.test.ts test/workflow/model-selection.test.ts --timeout 30000` from `packages/apexo` passed 14 tests and 70 assertions. `bun typecheck` from `packages/apexo` passed. The precise admission/assertion constraint is recorded in [RULE-20261015-003](../../rules/branded-fixture-values.md); the central index now activates it after live verification. On 2026-10-15, the integrated focused gate passed 14 tests / 70 assertions and all 21 repository typecheck tasks passed. These reruns verify the correction and do not add occurrences.

## Fourth occurrence: restoration response identity

The new cold native HTTP restoration fixture decoded the creation response ID with `Schema.String`, then compared a branded `SessionID` from `SessionSchedule.Restoration` with that plain string. Its private Apexo typecheck failed with `TS2769`: a string was not assignable to `string & Brand<"SessionID">`. The preceding restoration behavior batch passed at runtime, so that success did not prove the fixture's typed contract.

The fixture now decodes the creation response with the canonical `SessionID` schema. Assertions and subsequent child admission therefore retain the same validated brand. No production schema, response, or assertion contract is weakened. This is another independent typed-assertion episode covered by [RULE-20261015-003](../../rules/branded-fixture-values.md). The corrected `bun typecheck` from `packages/apexo` passed. The expanded five-file restoration batch passed 18 tests and 181 assertions, including the actual HTTP empty-child case. Shared integration remains pending.

The fourth correction is now integrated: the shared five-file restoration gate passes18 tests/181 assertions and `bun turbo typecheck --concurrency=2` passes all21 workspace tasks. No brand or assertion was weakened.

## Fifth occurrence: Workflow selected Agent and Model assertions

The new private Workflow agent-selection fixture compared branded `AgentV2.ID` and `Model.ID` values with plain expected strings. Its first Apexo typecheck rejected both expectations with `TS2769`; the earlier runtime pass did not establish type safety. The assertions now construct expected values with `AgentV2.ID.make` and `Model.ID.make`. The corrected Apexo package typecheck passed, and the focused Workflow suite passes 39 tests / 268 assertions on pinned Bun 1.3.14. This independently authored fixture episode is covered by the existing [RULE-20261015-003](../../rules/branded-fixture-values.md); no new constraint is added. Shared integration is pending.
