# BUG-20261015-080: Task terminal fixture stores a reconciliation function

- Status: corrected; isolated native mini acceptance passed after the fixture correction.
- Scope: new native Task terminal acceptance harness only.
- Independent occurrences: one authoring episode.

The first native mini harness timed out waiting for Task rows. Real native list requests succeeded with HTTP 200, while the terminal reported `props.tasks().map is not a function`.

The harness placed `reconcile(next.items)` inside an object patch. Solid's reconciliation helper is a setter function, not the replacement array itself; the object patch stored that function as `items`. Production Task adapters and panels did not make this mistake.

The fixture now calls `setState("items", reconcile(next.items))`, then updates the remaining metadata separately. Failure evidence captures the terminal buffer before process cleanup resets the alternate screen.

Verification from `packages/apexo`: `bun script/grok-native-task-tui.mjs --narrow` passed 3 checks with 8 provider requests. Real native Task creation, restart interruption, passive list/output, cancellation conflict, joined cancellation, and long completed output were exercised. Subsequent layout verification is tracked separately in BUG-20261015-082.

A later measurement-only attempt to request a geometry dump through SIGUSR2 timed out without producing the file. Its signal-delivery cause was not established; it is not counted as another reconciliation occurrence or a product defect. The isolated harness now writes periodic renderer snapshots, and the accepted geometry checks read fresh snapshots after each visible state settles.


Shared verification: App and terminal adapters each passed six tests / 32 assertions, all 21 typecheck tasks passed, and both live native mini/fullscreen narrow PTYs passed three checks / eight provider calls. Production browser and actual rebuilt Desktop window each passed six checks / eight calls. These reruns add no independent bug occurrence.
