# BUG-20261015-101: Task admission fixture retained the old owner-specific message

- **Status:** Exact fixture assertion repaired and verified in the shared branch.
- **Scope:** Native/compatibility Task admission E2E assertion. Production admission remains unchanged.
- **Observed:** The complete isolated unit gate failed at the Workflow-launch rejection message assertion. The expected text was `Managed Task children cannot launch workflows`; the actual typed `InvalidRequestError` contained `Managed children cannot launch workflows`. The HTTP400 assertion had already passed.
- **Expected:** The fixture must assert the current rejection contract, which covers Task, Workflow and Goal children through shared private ownership.
- **Root cause:** The shared managed-child boundary deliberately generalized its fixed message, while this older Task-specific E2E retained its previous string.
- **Fix:** Replace only that expected message. Preserve every native/compatibility status, no-inbox/no-transcript mutation assertion, process marker check and provider-count assertion.
- **Verification:** The original isolated full gate reported 4,106 passes, 19 skips, one todo, two failures, 53 snapshots and 13,989 assertions across 376 files. This record covers only the exact message mismatch. The separate ordinary V2 completion timeout is unresolved and is not attributed to this fixture. After hash-verified shared integration, `bun test test/e2e/v2-task-admission.e2e.test.ts` from `packages/apexo` passed two tests / 43 assertions with clean exit.

This is one fixture contract-maintenance episode, not a production permission failure or a recurrence of unrelated timeout symptoms.
