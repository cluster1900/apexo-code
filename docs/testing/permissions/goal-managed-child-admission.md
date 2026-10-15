# BUG-20261015-083: Native Goal Children Accept Unrelated Prompts

- **Scope:** Native Goal planning, verification, and closing-summary child Session admission.
- **Status:** Integrated prompt-admission repair; CLI and rebuilt Desktop scoped acceptance passed.
- **Independent occurrences:** One Goal integration episode with three child-role scenarios. Task and Workflow findings are separate records, not additional Goal occurrences.

## Observed and expected behavior

A real native Goal executes through planning, worker execution, evaluation, independent verification, and closing summary using a local provider. A direct `session.created` observer holds each review or summary child after projection but before the producer finishes setup. A separate caller submits an unrelated `SessionV2.prompt` with `resume: false`.

For planning, verifying, and closing summary, admission returned Success and persisted one unrelated `session_input` row. The required result is rejection before durable inbox or transcript mutation. Only the owning Goal launch may admit a managed child's input. Closing summary remains tool-free, but that restriction does not establish input ownership.

## Reproduction

Run the isolated `goal-created-admission.test.ts` probe with pinned Bun 1.3.14, a private HOME and all XDG directories, actual Core services, real SQLite, and the local TestLLMServer. Hold Created, submit the independent admit-only prompt, inspect the actual inbox, release the observer, and join the native parent drain. Assert Failure and zero inbox rows for all three child roles.

The unchanged implementation completed the native flow and exited with the expected regression assertion failure in under one second of test execution: all three observations were Success/one row. This is a concrete admission failure, not a timeout inference or a mocked execution path. The initial malformed fixture Goal ID was a separate setup failure covered by [BUG146](../test-fixtures/native-compaction-goal-id.md).

## Root cause and repair contract

Public native prompt admission has no durable managed-child guard for Goal children. The producers publish Created before attaching live role capabilities and admitting owned input. A lifecycle mutation lease allows independent admitted operations and is not a managed-input authorization mechanism. The runner's metadata-based role checks do not prevent inbox persistence.

The repair atomically commits private authority with Created, binds it to original parent and child creation proofs, and rejects public native and compatibility input paths. Genuine reviewer reuse must independently validate the Goal's durable reviewer receipt and private authority; mutable Session metadata cannot grant ownership. Goal ID reuse after clearing must not authorize a prior child. Ephemeral role capabilities remain required for provider execution, cancellation, report access, and usage accounting.

## Verification

The final composed isolated `bun test test/session/goal-managed-admission.test.ts --timeout 30000` passed two tests / 16 assertions. The first runs planning, verifying and closing summary; the second requires further worker proof and reuses the first verifier on the next round. Every held Created notification rejects unrelated input with zero inbox rows while the legitimate Goal completes. Core and Apexo package typechecks passed. Reviewer reuse checks private ownership, the durable previous-reviewer receipt, and the original verifying attempt.

The shared integration includes this source and corrected fixture. CLI/Desktop summary lifecycle, restart and compatibility guards and the final shared aggregate still require verification. The separately confirmed public-resume ownership gap is tracked as BUG-20261015-091; this prompt-admission repair does not claim to fix that entrypoint. Installed Grok cannot verify Apexo's private HTTP authorization boundary.


## Shared integration acceptance

The composed live implementation passed 12 tests / 217 assertions across ten files, all 21 repository typecheck tasks, and generated migration consistency. The Workflow boundary fixture passed four checks / two provider calls in each real CLI and rebuilt Desktop backend. Goal closing-summary acceptance passed ten checks / 80 provider calls in each backend, covering success, budget, incomplete/provider/tool responses, held child, cancellation, clear and actual process restart. Public metadata removal cannot permit unrelated native or compatibility input during or after a summary.

The isolated installed closing-summary comparison separately passed two checks / 24 total provider requests. It establishes reference lifecycle behavior, not Apexo private-table authorization. The newly confirmed public-resume early-start gap is tracked separately as BUG-20261015-091 and remains under repair; these passes do not establish that entrypoint. Complete aggregate gates remain open.
