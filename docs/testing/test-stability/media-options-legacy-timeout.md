# Native media options legacy configuration test deadline

- **ID:** BUG-20261015-148.
- **Status:** Investigating; no production repair claimed.
- **Occurrences:** One observed failure; root cause unknown.
- **Scope:** `test/e2e/v2-media-options.e2e.test.ts`, legacy invalid-selection variant.

## Observed and expected behavior

The first shared Shell/media/Plan combined suite timed out the legacy invalid-selection case at its explicit twenty-second whole-test deadline (reported duration 22,117.55 ms). The preceding native case took 17,637.06 ms. The expected behavior is an error tool receipt with zero outbound media calls and ordinary language continuation, preserving an invalid higher-priority media selection. The failed run did not capture its final setup, operation or teardown phase.

## Reproduction and evidence

From `packages/apexo`, include `test/e2e/v2-media-options.e2e.test.ts` in the native Shell/media/Plan test suite. The failure occurred during shared type/build/acceptance activity; this overlap does not establish host contention as the cause. The original suite ended with 57 passes, one deadline failure and three separately recorded module-load errors (BUG145).

An unchanged isolated run of `bun test test/e2e/v2-media-options.e2e.test.ts -t 'explicit media document validation preserves authority: legacy'` passed one test and four assertions in 1,564.36 ms, with exit zero. The accepted private checkpoint previously passed this case in 2,513.89 ms. These observations do not identify or repair the failed run.

## Diagnosis and fix status

The outer deadline is twenty seconds and the existing completion poll is fifteen seconds. No deadline, production behavior or assertion has been weakened. The exact delayed phase and root cause remain unknown. This is not counted as a recurrence of another unexplained media timing symptom, and it does not justify a recurring constraint. Further aggregate verification is pending.

The subsequent shared twelve-file command passed all 68 tests / 623 assertions in 52.78 seconds with exit zero. The legacy case and all other media-options variants passed unchanged. This supplies aggregate acceptance but does not identify the earlier delayed phase or establish a causal fix.
