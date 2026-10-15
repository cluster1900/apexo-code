# BUG-20261015-107: Sandbox comparison route used an unregistered server

- **Scope:** Browser compatibility-control acceptance in `grok-native-sandbox-ui.mjs`.
- **Status:** Fixture repaired; browser and actual native-window verification passed.
- **Independent occurrences:** One authoring episode; repeated diagnostics are the same failure.

## Observation and expected behavior

After seven native sandbox checks, opening a compatibility Session route showed the App error boundary instead of the sandbox controls. The expected scenario is a registered compatibility connection with all three creation profiles disabled, Off selected, an explanatory message and no new Session or provider work.

## Root cause

The fixture put the compatibility server URL in the route but omitted it from the browser's saved server list. `TargetServerRoute` resolves its connection from that list; the SDK fell back to the current native server when the entry was absent. Captured requests showed the compatibility Session ID being fetched from the native fixture and returning `SessionNotFoundError`. Reading the error textarea value confirmed that cause; body text alone omitted it. This does not demonstrate a sandbox protocol-selection defect for a configured connection.

## Correction and verification

Register the fixture-owned compatibility connection in the same persisted server store before navigating. Keep native Desktop setup on its existing explicit server registration path. Failure capture now includes readonly textarea/input values as well as page text, without modifying product exception behavior.

From `packages/apexo`, `bun script/grok-native-sandbox-ui.mjs browser --locales --compat-control` passed eight checks / three provider calls after the repair. The new check confirms all three profiles disabled, Off retained, visible compatibility explanation, unchanged compatibility Session count and zero compatibility provider calls. The Traditional Chinese screenshot was inspected and the explanation/controls are readable. The matching `native --locales --compat-control` run also passed eight checks / three calls against the actual rebuilt native Desktop window. Its compatibility screenshot was inspected: disabled choices and the localized explanation are readable. Both owned runs exited and reaped their processes.
