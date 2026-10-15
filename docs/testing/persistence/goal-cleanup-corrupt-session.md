# BUG-20261014-022: Corrupt Goal state prevents Session deletion

- Status: Fixed and verified. Verified occurrences: 1. No recurring constraint.
- Scope: Session deletion with automatic Goal report cleanup.
- Observed: DELETE returned 200, but a subsequent GET still returned 200. Expected: users can delete a Session even when its Goal state cannot be decoded.
- Reproduction: Create a Goal, replace session_goal.data with an empty object, delete its parent Session through HTTP, then fetch the Session. Run `bun test test/server/httpapi-goal.test.ts --test-name-pattern 'broken Session'` from `packages/apexo`.
- Root cause: The new deletion path required decoding the Goal before cancellation and cleanup preparation. Decode failure reached the logging boundary before actual deletion.
- Fix: Log GoalStorageError and continue cancellation. Cleanup can recover owned Session/Goal directories without the malformed state; it does not guess ownership of legacy flat directories. Other cleanup preparation failures still prevent deletion from losing ownership information.
- Verification: The focused test passed with DELETE 200 followed by GET 404. The final five-file regression passed 155 tests, one existing skip, zero failures.
- Occurrence evidence: On 2026-10-14, the initial regression expected GET 404 but received 200 after DELETE.
