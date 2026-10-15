# BUG-20261015-062: Direct managed Task prompt admission stranded input

- **Type:** Draft runtime defect; not integrated production.
- **Scope:** Native Task child ownership and public Session prompt admission.
- **Observed:** The initial six-provider-call foreground/follow-up/output regression accepted a direct child prompt with HTTP 200, while the one-use child drain guard correctly prevented another provider call. The durable inbox row therefore had no authorized execution path.
- **Expected:** Unsupported direct admission must fail before persistence. A legitimate owned Task follow-up must remain usable afterward.
- **Cause:** The draft gated model execution with private ownership but left public prompt admission generic.
- **Fix:** Reject actual Created-bound private Task children before SessionInput.admit using typed ManagedInputError, mapped to existing HTTP 409. Task launch/follow-up retains its separate private capability and deterministic admission. Managed prompts are not authorized by public metadata.
- **Verification:** In the isolated native Task implementation, `bun test test/v2/task-authority.test.ts test/v2/task-store.test.ts test/e2e/v2-task.e2e.test.ts test/e2e/v2-task-admission.e2e.test.ts` passed 6 tests and 90 assertions. The original follow-up scenario now rejects direct admission, then completes a legitimate third owned turn (9 provider calls total). The separate mixed HTTP case rejects ten native/compatibility execution surfaces and native manual compaction, checks exact inbox/transcript equality, zero additional provider calls, no shell marker and no Goal/Workflow/BTW state, then successfully executes the ordinary parent. Core and Apexo package typechecks passed. These are off-tree implementation results, not live CLI/Desktop acceptance.

Final authority review found the shared `managed` query returned false for a
present record with stale parent/child Created proof. Native prompt's separate
read/owned check already failed before persistence, but compatibility and
side-question callers could misclassify that record as an ordinary Session.
The shared query now returns false only for an absent row; present stale or
invalid authority fails with typed stale/storage. Public native and compatibility
guards translate that failure through their existing declared rejection channels.
Real-store regression deliberately changes each proof independently, verifies
typed stale, native prompt rejection and an empty inbox, then verifies an ordinary
reused ID is unmanaged after actual FK-cascading deletion. This is a correction
within the same managed-admission scope, not an invented historical recurrence.

The final composed suite passed 10 tests/182 assertions after stale-proof handling; Apexo package typechecking passed.
