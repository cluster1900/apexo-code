# BUG-20261015-310: Active Task delivery fixture ignored the existing permission alias

- Scope: Private native Task delivery permission-race HTTP test.
- Observed: The test timed out before the held child provider request. Retained parent transcript showed the initial Task tool still running; the actual pending permission was canonical action `task` for resource `helper`.
- Expected: Launch the child normally, then hold only message-send permission and cancel the child before allowing that send.
- Reproduction: Configure `send_subagent_message` with resource `*` and effect `ask`, launch a Task, then wait for its child model before replying to any permission.
- Root cause: Existing `PermissionV1.canonicalPermission` maps `send_subagent_message` to `task`. The broad fixture rule also asked for initial Task creation. The initial five-second test timeout and later bounded eight-second readiness failure are one diagnosis, not separate occurrences.
- Fix: Keep the production alias unchanged. Scope the fixture ask to Session-ID resources (`ses_*`), and select the pending canonical `task` request with the exact child ID. The fixture has an explicit overall budget that contains its readiness budgets.
- Verification: In `packages/apexo`, pinned Bun 1.3.14, `bun test test/e2e/v2-task-message.e2e.test.ts --test-name-pattern 'cancellation during permission'` passed one test / five assertions. Cancellation returned joined terminal state; approving the pending send afterward returned conflict and no message receipt. No production permission change was needed.
- Independent occurrences: One confirmed fixture-authoring episode. No recurring constraint is promoted.
