# INVESTIGATION-20261014-003: Goal Dialog Unexpectedly Closed After Automated Click in Native Window

- **Status**: Investigating for historical uninstrumented runs; offscreen click path fixed in [BUG-20261014-017](../test-fixtures/goal-native-offscreen-click.md).
- **Scope**: Real macOS Electron window tested via `bun script/grok-goal-native.mjs`.
- **Observed**: Three early runs lost the Goal dialog at different steps (clicking clear Goal after report cleanup, confirming report deletion, and expanding the third verifier) when the script did not explicitly scroll targets into view before clicking.
- **Expected**: Clicking a visible button or summary inside the dialog executes only that action and keeps the dialog open.
- **Follow-up**: Direct click-trace diagnostics later proved that clicking an offscreen button (`y=812` in an 800px window) hit `<html>` and triggered Kobalte's outside-click dismissal ([BUG-20261014-017](../test-fixtures/goal-native-offscreen-click.md)). After enforcing `scrollIntoView`, position-stability polling, and `elementFromPoint` hit verification, all 7 native scenarios passed. Earlier uninstrumented runs are retained here without assuming they all shared the same root cause.

2026-10-14 cleanup diagnostics also observed a full native run where the third verifier's summary click was recorded as hitting the intended element, but the subsequent open-details count was zero and the dialog was absent in the failure snapshot. That run stopped before report preview testing. A later full run passed the same step. No cause or common identity with the earlier dialog-disappearance cases has been established; retain it as an unresolved observation, not a verified recurrence or fix.
