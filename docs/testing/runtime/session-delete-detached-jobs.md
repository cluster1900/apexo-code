# BUG-20261014-025: Session deletion leaves detached Shell jobs running

- Status: Fixed and verified. Verified occurrences: 1. No recurring constraint.
- Scope: Running-chain and background-job cancellation during Session deletion.
- Observed: A detached Shell identified only by ownerSessionId remained running after its Session was deleted. Expected: cancel owned jobs while leaving unrelated jobs running.
- Reproduction: Register two real BackgroundJob jobs running Effect.never, owned by the deleted Session and another Session. Delete the first Session and inspect both statuses. From `packages/apexo`, run `bun test test/server/httpapi-goal.test.ts --test-name-pattern 'detached shell'`.
- Root cause: Replacing deletion-specific cancellation with SessionRunState.cancel overlooked their different scopes. The runner follows sessionId/parentSessionId; detached Shell jobs use ownerSessionId.
- Fix: After interrupting the running chain, Session.remove also cancels remaining jobs selected by BackgroundJob.owns. Ordinary foreground interruption keeps its existing behavior.
- Verification: The final cleanup/Goal/prompt regression passed 155 tests, one existing skip, and zero failures, including owned-job cancellation and unrelated-job preservation. From `packages/apexo`, `bun script/grok-task-contract.mjs cli` and `bun script/grok-task-contract.mjs desktop` each passed 25 cases with real detached Shell PIDs: the deleted Session's process exited and the unrelated Session's process remained alive. Final repository typecheck passed 21/21 tasks; the production Desktop was rebuilt before its runtime checks.
- Occurrence evidence: On 2026-10-14, the focused pre-fix test expected cancelled but observed running.
