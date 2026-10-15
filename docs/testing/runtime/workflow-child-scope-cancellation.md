# BUG-20261014-060: Concurrent workflow interruption returned before child finalization

- Scope: First-party Workflow panel execution and cancellation ownership.
- Observed: The interruption regression timed out at its unchanged five-second deadline. The parent fiber had exited, but the child finalizer signal never arrived. A minimal Effect reproduction with concurrent forEach exhibited the same behavior.
- Expected: Parent interruption waits for every owned child finalizer before returning or permitting resume.
- Reproduction: Hold a panel child in Effect.never with a finalizer signal, interrupt the parent run, and await the child finalizer.
- Root cause: The initial engine relied on concurrent forEach's internal fibers as the ownership boundary. In the pinned Effect version, interruption of that traversal did not provide the required scoped child finalization guarantee.
- Fix: Fork each child explicitly into the panel scope and bound its execution with a semaphore. Join those fibers for results; closing the panel scope interrupts and awaits its owned children.
- Verification: The minimal explicit forkScoped reproduction finalized the child before the parent returned. From packages/apexo, `bun test test/workflow/engine.test.ts` passed three tests and 14 assertions, including interruption and explicit resume, at the original five-second deadlines.
- Occurrences: One implementation failure confirmed with a focused reproduction. No broad timeout increase or recurring constraint.
