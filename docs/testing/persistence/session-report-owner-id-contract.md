# BUG-20261015-108: Report cleanup rejects an accepted Session ID

- **Status:** Fixed and verified in shared tests, CLI and rebuilt Desktop. Root cause is separate from media cancellation.
- **Scope:** Native Session deletion, Goal report owner discovery and public Session ID compatibility.
- **Observed episodes:** One media lifecycle test exposed the mismatch; two diagnostic reruns captured the same failure, not independent recurrences.

## Observation

A real native HTTP test created `ses_media_reused`, started an image-generation tool, held its local media HTTP response, then deleted the Session. Creation returned 200; deletion returned 503 with `ServiceUnavailableError`: “Session deletion could not finish. Retry the deletion.” The expected response was 204 after joined teardown.

Private diagnostics captured the cause before the safe HTTP mapping: `SessionLifecycle.Failure: Session retirement did not complete`. The underlying retirement exit was `UnknownError` from `SessionGoalCleanup.prepareSession`, caused by `SessionGoalReports.owners`: **Invalid report Session**. Teardown had reached report cleanup; this evidence does not establish an escaped or unjoined media worker.

## Root cause

`packages/schema/src/session-id.ts` accepts strings starting with `ses`, including the supplied ID. `packages/core/src/session/goal-reports.ts` requires `^ses_[a-zA-Z0-9]+$` before report-owner discovery. Deletion invokes that discovery even when the Session has no Goal. The report directory safety restriction is therefore narrower than the existing public creation contract and rejects an already accepted Session.

Do not repair this by permitting path traversal in report paths, narrowing the public Session ID schema retroactively, or calling a generated-ID fixture change a product fix. A safe report-owner directory mapping must preserve canonical historical layouts and prevent collisions or ownership confusion for other accepted IDs.

## Verification boundary

The initial four-case media gate had three passes and this one failure, with 46 assertions. Two focused diagnostic runs retained the 503 and captured the failure boundary and original Cause. Diagnostic edits were private and restored exactly.

Changing only the media lifecycle fixture to generate a canonical Session ID and explicitly recreate that same ID allows the intended held-response deletion/reuse scenario to pass. The resulting media gate passed four tests and 54 assertions. This isolates media cancellation coverage; it **does not fix or close this accepted-ID cleanup bug**. The product repair and dedicated accepted-ID/path-safety regressions remain pending.

## Product repair and shared verification

Goal report creation, owner discovery and catalog/cleanup now use one bounded directory mapping. Historical canonical ASCII Session components of at most 255 bytes keep their exact existing names. Other accepted public IDs map to a reserved `session-` prefix plus SHA-256 of their JSON string, preserving exact string identity while excluding separators, NUL, Unicode normalization and oversized components from filesystem names. Stored report metadata still validates the original Session and Goal identity. The public ID schema is unchanged.

The dedicated pre-fix command reproduced two failures: no-Goal deletion returned 503 for the accepted custom ID, and report discovery rejected the same ID. After repair, `bun test test/session/goal-reports.test.ts test/session/goal-cleanup.test.ts test/session/native-delete.test.ts test/e2e/v2-session-delete.e2e.test.ts --timeout 30000` passed 23 tests / 188 assertions. It covers custom names, separators, Unicode, NUL and oversized IDs through real report creation/read/cleanup, existing legacy layouts and ownership protections, plus actual HTTP deletion/reuse. Core and Apexo package typechecks passed.

After rebuilding Desktop, `bun script/grok-native-session-id-cleanup.mjs cli` and `desktop` each passed six checks with zero provider requests: underscore, hyphen and Unicode IDs each survived two create/delete lifetimes with 404 after deletion. These are Apexo lifecycle regressions; no Grok ownership or filesystem implementation is imported. The original media diagnostic and generated-ID fixture change remain separate evidence, as described above.
