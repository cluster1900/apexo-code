# RULE-20261015-015: Observe enabled terminal actions before sending them

- Status: Active; three verified independent episodes.
- Scope: Real mini/fullscreen terminal fixtures driving actions guarded by pending asynchronous work.
- Source: [BUG-20261014-157](../testing/test-fixtures/hooks-terminal-pending-action.md): Hook reload during refresh, Plugins Apply before passive runtime refresh, and Process Wait completion before its list/detail refresh settled.
- **MUST:** Wait for the desired data and observable enabled/idle state of the exact action before sending its shortcut. Data can render before a pending action's final cleanup completes.
- **NEVER:** Treat a success/result string alone as action readiness, add a sleep to hide the race, or repeatedly press the shortcut until it succeeds.
- **MUST:** Derive readiness from the actual UI contract, such as an absent pending indicator or a rendered enabled action. If using terminal cells, verify the selected action's actual styling contract and retain evidence of disabled and enabled states.
- Verification: Use a bounded held asynchronous response to establish that the result can be visible while the action is disabled, then release it and send exactly one next action. Verify the intended request occurs, unrelated provider work does not occur, and owned fixtures are cleaned up. A passing uninstrumented rerun alone does not prove the original cause.
