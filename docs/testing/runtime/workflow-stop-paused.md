# BUG-20261014-120: Stopping a paused workflow kept it paused

- Scope: Workflow durable lifecycle, exposed by both real mini and fullscreen terminal management UI (two observed failures).
- Observed: after successful launch, budget resume, and pause, confirmed stop returned without error but the run remained paused.
- Expected: explicitly stopping a paused or budget-limited workflow marks it cancelled; completed or failed history remains unchanged.
- Reproduction: pause a running workflow, then call its stop endpoint or confirm stop in the terminal dashboard.
- Root cause: `WorkflowStore.stop` restricted both pause and cancel transitions to pending/running states. The cancel path therefore silently ignored paused runs.
- Fix: the backend owner permits explicit cancellation from paused and budget-limited states while preserving completed/failed history.
- Verification: mini and fullscreen each passed ten real PTY checks, including pause followed by confirmed stop and the decline-confirmation path. The backend owner ran `bun test test/workflow/ test/e2e/v2-session.e2e.test.ts` from `packages/apexo`: 15 tests and 88 assertions passed, including four assertions in the dedicated paused/budget-limited stop regression. Core typecheck passed.
