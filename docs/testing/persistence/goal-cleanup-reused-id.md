# BUG-20261014-023: Reusing a Goal ID permanently blocks old cleanup work

- Status: Fixed and verified. Verified occurrences: 1. No recurring constraint.
- Scope: Goal lifetime guards in the durable cleanup queue.
- Observed: After clearing an old Goal, creating another with the same ID, and stopping it, the old report remained indefinitely. Expected: protect resumable work and eventually remove only the old job's captured report IDs.
- Reproduction: Make old report deletion fail with a substituted directory symlink, clear its Goal, restore the directory, and create a new Goal and report with the same Goal ID. Verify protection while active, exhaust the new budget, then retry the old cleanup job.
- Root cause: The goal_cleared guard compared only Goal ID and could not distinguish a new lifetime.
- Fix: Compare ID and creation time when protecting the original Goal whose clear has not committed. Continue protecting any resumable current Goal. Retry only the report IDs already persisted in the old job.
- Verification: `GITHUB_ACTIONS=false bun test test/session/goal-cleanup.test.ts` passed 5 tests and 27 assertions. The replacement test verifies active protection, removal of old reports after the new Goal stops, and preservation of new reports.
- Occurrence evidence: On 2026-10-14, the first real-ID-reuse regression found the old plan still present. New files were not deleted.
