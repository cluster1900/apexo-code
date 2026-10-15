# BUG-20261015-054: Native Task validation combined stale dependencies

- **Type:** Test fixture; one validation-snapshot authoring episode.
- **Scope:** Isolated native Task draft validation, never live production.
- **Observed:** Core typechecking rejected the new runner compaction `hooks` dependency against an older copied compactor. A later Apexo check found only missing `WorkflowInfo.resumeBlockedReason` and `usageIncomplete` in its stale copied SDK.
- **Expected:** Every validation cycle uses a coherent dependency snapshot plus the declared owned overlay.
- **Cause:** An earlier feature's validation tree was reused without checking all unowned package versions. The Task changes themselves did not remove these interfaces.
- **Correction:** Refresh unowned Core/Schema from one source checkpoint; take current Client/SDK copies only after their generators finish; retain owned patches separately. Save a per-file hash manifest before each cycle. Do not count different diagnostics from this one snapshot episode as independent recurrence.
- **Verification:** After the Core refresh, package `bun typecheck` passed. After the generated dependency refresh, those WorkflowInfo diagnostics disappeared; subsequent Task-specific errors are recorded separately. The final composed Core and Apexo package typechecks passed. The composed native Task gate passed 10 tests/162 assertions, expanded boundaries passed 2 tests/39 assertions, and CLI passed five checks/15 provider calls.

During final composition, refreshing source without its unowned Hook tests/TUI and
OAuth generated SDK exposed additional stale consumer diagnostics. The coherent
snapshot now includes those leaves, the current Hook/effort baseline, and declared
sandbox creation/API overlays. Owned Task changes were rebased by hunk rather than
replaced wholesale. These diagnostics extend the same snapshot-authoring record;
they are not counted as independent recurring product defects.
