# BUG-20261015-381: Session usage zero-step failed settlement retention, event ordering, and CLI runtime Hook session initialization

Status: **Fixed and verified** (2026-10-15).

## Scope and observed behavior

1. `packages/apexo/src/cli/cmd/usage.ts` (`buildNativeSessionUsageReport`):
   - When a `SessionEvent.InputSettled` event had `status === "failed"` (or `status === "interrupted"` with zero recorded steps) and `usageIncomplete: false`, the guard `if (event.data.usageIncomplete || event.data.status === "failed" || ...)` entered the branch, but the assignment `targetTurn.incompleteFromSettlement = targetTurn.incompleteFromSettlement || event.data.usageIncomplete` evaluated to `false`. At turn finalization, zero-step turns check `turn.incompleteFromSettlement`, so a prompt that failed before its first `Step.Started` was silently dropped instead of being retained as an incomplete turn (`usageIsIncomplete: true`, `steps: 0`).
   - Deduplicated native events were iterated in raw slice order without sorting by `durable.seq`, so out-of-order replay/page delivery could pair `Step.Ended` before `Step.Started` or misattribute steps across turns.
2. `packages/apexo/src/cli/cmd/usage.ts` (`buildCompatibilitySessionUsageReport`):
   - When compatibility messages arrived with an assistant message preceding its parent user message in array order, `ensureTurn` initialized the turn timestamp from the assistant message (`created ?? 0`) and did not update it to the earlier user message timestamp when the user message was processed.
3. `packages/apexo/src/cli/cmd/run/runtime.ts` (`hooksActions`):
   - `hooksActions.get` called `await ensureSession()` before inspecting `state.sessionID`, whereas `trust`, `preference`, and `reload` checked `if (!state.sessionID)` directly and failed if invoked before the first lazy session initialization.

## Expected behavior

- Zero-step prompts whose settlement status is `"failed"` or `"interrupted"` must set `targetTurn.incompleteFromSettlement = true` and `incomplete = true`, retaining the turn with `steps: 0` and marking the turn and session `usageIsIncomplete: true`.
- Deduplicated native session events must be sorted deterministically by `durable.seq` ascending (preserving relative index on ties) before turn/step aggregation.
- Compatibility turns must preserve the earliest positive timestamp when the user message is encountered after an assistant message referencing its `parentID`.
- `hooksActions.trust`, `hooksActions.preference`, and `hooksActions.reload` must call `await ensureSession()` before checking `state.sessionID`.

## Reproduction steps

1. Emit `SessionEvent.Prompted` (`inputID: "in_zero_fail"`) followed by `SessionEvent.InputSettled` (`inputID: "in_zero_fail"`, `status: "failed"`, `usageIncomplete: false`) with no `Step.Started` event, and run `buildNativeSessionUsageReport`.
2. Pass deduplicated `SessionEvent.Any` items with inverted `durable.seq` order (`Step.Ended` at `seq: 4` before `Step.Started` at `seq: 3`) into `buildNativeSessionUsageReport`.
3. Pass compatibility messages where the assistant message (`time.created: 2000`, `parentID: "msg_u"`) precedes the user message (`id: "msg_u"`, `time.created: 1000`) into `buildCompatibilitySessionUsageReport`.

## Root cause and fix

- In `packages/apexo/src/cli/cmd/usage.ts`:
  - Changed `targetTurn.incompleteFromSettlement = targetTurn.incompleteFromSettlement || event.data.usageIncomplete` to `targetTurn.incompleteFromSettlement = true` inside the `if (event.data.usageIncomplete || event.data.status === "failed" || (event.data.status === "interrupted" && targetTurn.steps.length === 0))` block.
  - Sorted deduplicated `events` by `durable.seq` ascending (breaking ties by original array index).
  - Updated `ensureTurn` in `buildCompatibilitySessionUsageReport` to update `existing.timestamp` when a positive user timestamp is earlier than the previously recorded timestamp.
- In `packages/apexo/src/cli/cmd/run/runtime.ts`:
  - Added `await ensureSession()` at the start of `hooksActions.trust`, `hooksActions.preference`, and `hooksActions.reload`.

## Verification commands and results

- Negative control: Reverting `targetTurn.incompleteFromSettlement = true` back to `targetTurn.incompleteFromSettlement || event.data.usageIncomplete` causes `packages/apexo/test/cli/usage.test.ts` test 9 (`adversarial native ledger: out-of-order seq, foreign session events, steered mid-turn prompts, and zero-step failed settlement`) to fail (`Expected: 2, Received: 1` turns).
- `bun test test/cli/usage.test.ts` (from `packages/apexo`) → `10 pass, 0 fail, 129 expect() calls`.
- `bun typecheck` (from `packages/apexo`) → exited `0`.
