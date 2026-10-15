# BUG-20261015-328: A Task editor could outlive its selected target

- Scope: native Task message operator editor in mini/fullscreen terminal and App connection changes.
- Observed: the mini list retains an index. A newly prepended Task can replace the selected item while the editor's draft controller still targets the original child. An editor must never show the replacement's running state while sending to the old child.
- Expected: changing client, owner, selected child or launch identity disposes the editor; uncertain input remains associated only with its original owner and launch.
- Reproduction: open the first Task, hold its send response, prepend another Task at index zero, then inspect the open editor and outbound route. This is independently reproducible through the real OpenTUI renderer and a local HTTP listener.
- Root cause: the editor captured its draft once, while the parent passed reactive selected-item data without a lifetime fence.
- Fix: close mini/fullscreen editors on immutable identity changes, key the App editor by client and child launch, show target identity, and cache drafts by client, parent, child and launch timestamp. The bounded cache never evicts an unresolved send merely to admit another draft.
- Verification: `bun test --timeout 30000 test/cli/run/task-message.test.ts test/cli/run/task-message-view.test.tsx` from `packages/apexo` verifies held-send abort, no request to the prepended child, retained original text/ID, empty new-child draft, and separate client/parent/replacement launch controllers. Production browser navigation and all four terminal layouts are verified by the commands in `docs/native-task-message-ui.md`.
- Independent occurrences: one reviewed and regression-tested implementation defect. No recurring rule is promoted.
