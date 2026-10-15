# Native Subagent Hooks

Apexo runs Subagent hooks inside its native Task and Session ownership chain.
The installed Grok executable is used only for isolated behavioral comparisons;
no native feature imports or launches it.

## Contract

- `SubagentStart` observes one accepted Task launch after deduplication, live role
  attachment and owner checks, before its first provider call. Its envelope uses
  the parent Session ID and the child Task ID and immutable Task agent type.
- `SubagentStop` is the child's normal-completion decision gate. It is not a Task
  finalizer or `SubagentFinished` notification. Provider failure, cancellation and
  the provider-turn limit do not enter this gate.
- The Task retains its parent's captured Hook registry and preference selection.
  Dispatch never reloads definitions from disk or trusts a bare child Session ID.
  Live launch owner, running status, immutable agent type, and both Session
  Created-event identities must match before dispatch.
- A `block` decision or nonempty `hookSpecificOutput.additionalContext` continues
  the child. `continue: false` allows stopping even alongside `block`. Command
  failure, invalid output and timeout fail open. At most eight Hook continuations
  are admitted per user input, and Hook feedback does not reset provider-turn or
  Goal budgets.
- `SubagentEnd`, `subagent_end` and `subagentEnd` normalize to `SubagentStop`;
  duplicate groups across aliases dispatch once. `SubagentFinished` is not a Hook
  event and cannot cause a second completion dispatch.
- Pending Task messages take precedence before gate evaluation. Message admission
  remains open while a gate is held; the final atomic continuation/close check
  sees messages admitted during dispatch, including when the Hook allows stopping.
- The existing durable Stop claim is recorded before external execution. Its
  SystemContext update carries continuation feedback. Cancellation aborts and
  joins the owned command; an interrupted evaluating claim cannot replay.

## Verification

Private focused verification passed 27 tests and 307 assertions across eight
files, including real HTTP/provider/command runs for continuation, eight-decision
cap, provider-turn allowance, queued messages before and during a held gate,
provider failure, cancellation before a gate, cancellation during a gate, alias
normalization, immutable ownership, nested Tasks, Goal accounting and existing
Task delivery. Core and Apexo package typechecks passed. After composition with completed-Task wake and Workflow authority changes, the
expanded gate passed 36 tests and 401 assertions across ten files; both package
typechecks and the three-scenario real source CLI acceptance passed again.

The native source CLI acceptance passed three scenarios: continuation, cancellation
of a held command, and a queued message admitted during a held gate. Each verifies
one Start event, expected Stop count, child provider count, durable Task status and
absence of every recorded Hook process after settlement. Compiled Desktop
acceptance was not part of that private checkpoint; the shared rebuilt acceptance follows below.

Commands from `packages/apexo`:

- `bun test test/e2e/v2-subagent-hooks.e2e.test.ts test/v2/subagent-hook-role.test.ts test/plugin/subagent-hooks.test.ts test/e2e/v2-task.e2e.test.ts test/e2e/v2-task-nested.e2e.test.ts test/e2e/v2-task-goal.e2e.test.ts test/e2e/v2-task-message.e2e.test.ts test/v2/task-message.test.ts`
- `bun script/grok-native-subagent-hooks.mjs cli`
- `bun script/grok-native-subagent-hooks.mjs desktop`
- `bun script/grok-subagent-hooks-official.mjs`
- `bun typecheck` from both `packages/core` and `packages/apexo`.

## Reference evidence

Pinned Grok source `session/acp_session_impl/updates.rs` dispatches SubagentStart
from the spawn update, while `session/acp_session_impl/stop_gate.rs` selects
SubagentStop for the child completion gate and excludes capped continuation.
The adjacent SubagentFinished handling does not run that decision gate again.

The isolated installed Grok 1.0.52 comparison passed both canonical SubagentStop
and SubagentEnd configurations. Each observed one Start and two Stop dispatches,
with one child continuation followed by force-stop, and four conversation
provider requests. Together these used eight conversation and eleven auxiliary
requests. The harness verified denial of host-home access and non-provider ports,
used a temporary home, and joined its owned runtime processes. These reference
observations are separate from Apexo implementation verification.

## Shared integration checkpoint

All fifteen handoff files were baseline/final hash-checked and integrated with completed-Task wake, Stop cancellation and Workflow selection. The combined focused gate passes 76 tests / 675 assertions across 24 files, and Core/Apexo package typechecks pass. Shared source CLI and the freshly rebuilt Desktop backend each pass all three scenarios with matching Hook/provider counts and process cleanup. The fresh isolated installed comparison passes both canonical/alias scenarios with eight conversation and eleven auxiliary requests. All 21 workspace typecheck tasks pass (19 valid cache hits). The full repository aggregate has not yet been refreshed for this tranche; the prior private evidence is retained separately.
