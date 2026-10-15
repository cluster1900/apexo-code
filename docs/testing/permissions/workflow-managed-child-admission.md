# BUG-20261015-077: Native Workflow Child Accepts an Unrelated Prompt

- **Scope:** Native Workflow child Session admission; confirmed on the integrated runtime before the pending Task and command-sandbox drafts.
- **Occurrences:** One independently reproduced Workflow episode. Task's atomic-ownership defect is tracked separately; no recurrence threshold is claimed here.
- **Status:** Repair verified in isolated source validation. Live integration and rebuilt Desktop verification remain pending; historical aggregate gates do not cover this repair.

## Observed and expected behavior

A held `session.created` listener exposes the newly projected Workflow child while its publisher is still notifying observers. A separate caller invokes `SessionV2.prompt` with that child ID and `resume: false`. Admission succeeds and persists one unrelated durable inbox row. The expected result is rejection before inbox or transcript mutation; only the Workflow's owned child launch should admit its input.

## Reproduction and evidence

Use the real native Session runner with a local provider. The parent invokes the native Workflow tool with one read-only definition stage. Hold the child's Created notification, issue the separate admit-only prompt, query `session_input`, release notification, and join the parent. The regression expects Failure and zero inbox rows; the unchanged implementation reports Success and one row. The scoped probe completed and exited with that assertion failure; this is not inferred from a timeout or from a mock.

The probe initially failed during setup because its temporary dependency link targeted the repository root rather than the owning package, then because copied Task-only sandbox imports referenced an unintegrated draft. Those startup failures did not exercise product behavior and are not additional occurrences of this defect. The dependency setup is recorded with [BUG037](../test-fixtures/hooks-preference-reference-contract.md).

## Root cause and repair

The public native prompt path has no durable managed-input guard for Workflow children. Workflow publishes Created before attaching its private child reference and live role. A lifecycle admission lease does not serialize independent prompt callers. The Task-only guard and sandbox policy inheritance do not establish Workflow input ownership.

A repair must register private Workflow child authority atomically with Created, bind it to the original parent and child creation identities, and reject unrelated admission at every public execution entrypoint. A metadata flag or an in-memory pending map alone is insufficient. Legitimate owned execution, safe existing-child continuation, cancellation, and usage accounting must retain their contracts. Goal children require a separate audit; no Goal failure is asserted here.

## Implemented boundary

A private `session_managed_child` row stores the parent and child Created event IDs and the Workflow run/task identity. The row and immutable command policy commit in the same Created transaction, before notification. Public input checks combine this authority with the existing private Task authority. A stale or malformed row is a typed refusal, never ordinary execution. Public metadata changes cannot remove authority.

Each owned Workflow drain has one scoped role capability and its deterministic input ID. The native runner validates private ownership, consumes the capability once, and promotes only that input. Output-schema correction receives a new capability for its second owned drain, while retaining the same child, permissions, model, and usage accounting. No executor or provider loop was added.

Historical immutable Created markers quarantine old children without granting execution. A child lacking private authority cannot be adopted from metadata: start a new Workflow run or Goal attempt. Reads preserve transcript and reports. Deletion cascades private authority; a genuinely recreated ordinary Session with the same ID remains usable.

## Verification

Pinned Bun 1.3.14, from `packages/apexo`, in isolated composed-source validation:

- `bun test test/workflow/managed-admission.test.ts test/workflow/managed-ownership.test.ts test/e2e/v2-workflow-schema.e2e.test.ts test/e2e/v2-workflow-model.e2e.test.ts test/e2e/v2-workflow.e2e.test.ts test/v2/task-created-admission.test.ts test/v2/task-store.test.ts`: **8 tests, 150 assertions, zero failures**. Includes held Created notification, metadata removal, direct resume rejection, rollback of projection/policy/authority/event/sequence, stale proofs, service reconstruction, explicit synthetic historical quarantine, ordinary ID reuse, existing Task receipt behavior, and real Workflow schema correction/model/budget paths.
- `bun script/grok-managed-child-admission.mjs cli`: **4 checks, 2 provider calls**. Real HTTP native prompt/BTW/Goal/Workflow and compatibility prompt/async/command/shell/summary reject while the child is active; transcript, Goal/Workflow/BTW state and filesystem remain unchanged. Owned completion uses one input/provider drain; manual compaction refuses; process restart retains authority without replay; deleted child ID can become an ordinary Session.
- Core, Apexo and Server package `bun typecheck` each passed on the final formatted isolated source. Live/Desktop evidence remains pending integration.

The store test's historical case is deliberately synthetic: real Created publication omits only the new ownership commit. It is not represented as captured user history. Installed Grok comparisons established the existing Workflow behavior; its ACP surface does not expose Apexo's HTTP child-admission or private ownership schema, so those comparisons cannot verify this repair. Goal's separately observed boundaries are recorded under BUG-20261015-083.


## Shared integration acceptance

The composed live implementation passed 12 tests / 217 assertions across ten files, all 21 repository typecheck tasks, and generated migration consistency. The Workflow boundary fixture passed four checks / two provider calls in each real CLI and rebuilt Desktop backend. Goal closing-summary acceptance passed ten checks / 80 provider calls in each backend, covering success, budget, incomplete/provider/tool responses, held child, cancellation, clear and actual process restart. Public metadata removal cannot permit unrelated native or compatibility input during or after a summary.

The isolated installed closing-summary comparison separately passed two checks / 24 total provider requests. It establishes reference lifecycle behavior, not Apexo private-table authorization. The newly confirmed public-resume early-start gap is tracked separately as BUG-20261015-091 and remains under repair; these passes do not establish that entrypoint. Complete aggregate gates remain open.
