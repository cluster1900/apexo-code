# Native Goal snapshot evidence isolation

## BUG-20261014-056

- **Scope:** Core native Goal evaluator and verifier transcript capture.
- **Observed:** Code inspection found that the initial native implementation removed legacy patch-like content variants but retained native assistant `snapshot.files` metadata. Native snapshots store file names at the message level, so filtering assistant content did not remove them.
- **Expected:** Automatic evidence must not expose host-generated changed-file names without the review role's read permission. Real user content and permission-authorized tool receipts remain available.
- **Reproduction:** Enable native snapshots, execute a worker turn, and inspect the independent verifier request's serialized transcript. Before the correction, the assistant message retained its snapshot object.
- **Root cause:** Applying the legacy message-part filtering shape to the distinct native V2 message schema.
- **Fix:** Omit native assistant `snapshot` from captured evidence. The separately captured and role-filtered change manifest remains the source of automatically provided file names.
- **Verification:** The native end-to-end test enables snapshots, checks that worker history contains a real snapshot, and asserts the verifier request excludes the snapshot property. `bun test test/e2e/v2-goal.e2e.test.ts` from `packages/apexo` passed one test and 34 assertions on Bun 1.3.14. No permission exploit or historical recurrence is claimed.
- **Recurrence:** One code-inspection finding. It is related to the earlier compatibility summary-diff boundary but is not counted as an independent repetition of that exact root cause.
