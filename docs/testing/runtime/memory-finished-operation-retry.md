# BUG-20261015-251: Finished Memory receipt briefly rejected immediate retry

- Status: corrected; shared combined lifecycle gate passed.
- Scope: durable native Memory operation completion and explicit retry admission.
- Verified occurrences: one product episode.

## Observed and expected behavior

The actual foreign-lease regression read a finished operation with `retry_required`, then immediately submitted a new operation with `retryOf`. Admission failed with `MemoryOperationFailure` / `busy`: the original operation was allegedly still running. A terminal result must permit explicit retry; any remaining local cleanup must be joined before the replacement starts. An actually running original operation must remain busy.

## Reproduction and root cause

Run `bun test test/v2/memory-lifecycle-native.test.ts` from `packages/apexo`, including the case that preserves an unreceipted foreign capture lease. The shared combined run passed 59 tests and failed at the immediate retry call. The controller commits its finished receipt before its scope finalizers release the lock and remove the process-local active entry. Admission checked only that entry's presence, ignoring the already published terminal state. No deadline expired in this failure.

## Fix

When the original durable receipt is finished and its local worker still exists, await that exact worker outside the short admission mutation lease. Continue to reject queued/running original work. Preserve the original fixed source plan, Created identity and strict foreign-lease protections. The regression keeps immediate retry without a sleep or polling for private worker state.

## Verification

The corrected combined gate passed 60 tests / 449 assertions across eleven files, including immediate retry, foreign lease preservation, controller shutdown, Session deletion and headless/Scheduler boundaries. No test deadline was increased. Refreshed workspace types passed all 21 tasks after the join amendment. Shared source CLI and rebuilt Desktop each passed five lifecycle checks, including exact explicit retry after a real process crash. Earlier unexplained Memory phase deadlines remain separate investigations.
