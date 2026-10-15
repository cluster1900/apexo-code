# BUG-20261015-184: Scheduler fixture assumed a missing Session returned undefined

- Status: Fixed and verified in the isolated Scheduler checkpoint; fixture-only.
- Occurrences: One authoring episode.
- Scope: `packages/apexo/test/v2/schedule-store.test.ts`.

The first real database test correctly prevented child admission after an intent update, then failed while checking the absent child. The assertion called `SessionV2.get(childID)` and expected `undefined`. That public service deliberately fails with `Session.NotFoundError`; the lower-level store lookup is the API that can return an absent value. The observed typed error proved the child was absent and did not indicate a Scheduler defect.

The test now obtains the actual Effect Result and verifies both the Failure branch and its `Session.NotFoundError` tag. Production Session lookup behavior is unchanged. Run `bun test test/v2/schedule-store.test.ts test/v2/task-store.test.ts` from `packages/apexo` to reproduce the corrected boundary.

The initial two-file run had one pass, one failure and 42 assertions. The corrected run passed both tests with 64 assertions. The later four-file Task/Scheduler regression passed five tests and 105 assertions, including Created admission and background ownership. These are private-checkpoint results; shared integration and CLI/Desktop Scheduler acceptance were not yet run.

During the same Scheduler fixture authoring episode, the held-claim test called `TaskStore.latest` to prove no Task was created. That ownership-requiring method returns typed `SessionTaskFailure` for a missing Task, rather than an optional record. The absence assertion now uses the actual optional `TaskStore.read` API. The expanded two-file gate passed five tests / 77 assertions. This is an explicitly separate method-contract correction within the same authoring episode, not another historical recurrence.
