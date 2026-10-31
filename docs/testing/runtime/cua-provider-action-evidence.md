# Cua provider action evidence

## Bug ID

`BROWSER-COMPUTER-USE-003`

## Affected scope

The Core Computer Service host backend, Cua Driver coordinate actions, provider result handling, and the authenticated native probe used by CLI/Desktop acceptance work.

## Observed behavior

A real macOS Calculator session accepted a Cua Driver click and returned `effect: Unverifiable`, but the first Apexo integration treated the request as completed without proving that the intended control changed. Raw desktop coordinates also became unreliable when the provider downscaled a 2940×1912 capture to 1600×1041. A click sent to a blank part of the Calculator display could therefore be reported as successful because the screenshot differed only by pointer or focus pixels.

## Expected behavior

Coordinates must be interpreted in the exact screenshot coordinate space supplied to the agent. Provider results with `Unverifiable` evidence must remain pending until Apexo reads the target window again and observes a semantic state change. A no-op or refused action must fail with an actionable message instead of being recorded as completed.

## Reproduction

1. Bring macOS Calculator to the foreground and enter `7`.
2. Start the authenticated native probe with a click action against the Calculator `C` button using coordinates from the 1600-pixel desktop screenshot.
3. Repeat with a blank display coordinate.
4. Before this fix, both calls could return `click completed by cua-driver`; the blank click did not change Calculator's displayed value.

## Root cause

The service constructed `ClickPosition.Coordinates` directly from caller coordinates even though Cua Driver had already produced a downscaled capture with a capture-specific transform. The service also compared only coarse visual state after an `Unverifiable` result. The first implementation did not read the exact front window's accessibility tree, so a cursor-only image change looked like action evidence.

## Fix

- Each Cua desktop observation parses the provider `capture_id` and clicks with `ClickPosition.CapturedCoordinates` tied to that capture.
- Cua host sessions maintain a lightweight `CaptureScope.Auto` reader alongside the desktop action session. The reader selects the largest visible application window, reads its accessibility tree, and adds that semantic text to the normalized snapshot.
- Input, key, and scroll actions use the reader's window target when a front window is available; desktop clicks remain screenshot-coordinate actions.
- `Confirmed` and `Partial` provider effects complete normally. `Unverifiable` actions complete only when the before/after semantic snapshot hashes differ; otherwise the service returns `Computer.Error` with the provider's verification guidance.
- Auxiliary macOS windows such as the small `Window` control surface are excluded from front-window selection so they cannot hide the real application tree.
- Lume sandboxes publish the third-party `cua-spacesd` endpoint as the `env` service on guest port `3211`, so the host SDK can attach deterministically.

## Verification

- `bun typecheck` from `packages/core` passes after the capture binding, semantic readback, and window-target changes.
- With Calculator displaying `7`, `APEXO_COMPUTER_PROBE_ACTION_JSON='{"action":"click","x":1172,"y":236}' bun script/computer-native-probe.mjs` returns `ready` and Calculator changes to `0`.
- With Calculator displaying `7`, the blank-display action `{"action":"click","x":800,"y":120}` fails with `Cua Driver could not verify click; the desktop snapshot did not change.` and Calculator remains `7`.
- With Calculator displaying `7`, `{"action":"press","key":"8"}` returns `ready` and the real Calculator value changes to `78` through a window-targeted Cua action.
- A `type` action against Calculator fails closed with the provider's `no_focused_text_input` explanation because Calculator does not expose a focused text field. This is the expected provider behavior; the service does not claim that text was entered.
- The first long-running HTTP effect exercise also exposed a lifecycle case: API scenarios can open a Computer session without sending an explicit close action. The service now registers a scope finalizer that closes every remaining Cua/Lume runtime before clearing its in-memory session map. A targeted effect exercise covering all five `v2.computer` routes passed after that change.
- A later isolated-runtime rerun exposed a Lume transport configuration gap: the VM booted and `cua-spacesd` was listening inside the guest, but the sandbox had no published `env:3211` service, so the host SDK could time out while attaching to `spacesd`. The sandbox now declares that service explicitly.
- After adding the explicit service and `/health` readiness probe, the real Lume probe passed observation, screenshot, close, and a provider-backed key action (`press completed by lume`). All ephemeral Lume VMs were stopped after verification.

## Remaining limitations

Semantic verification is bounded by the accessibility tree exposed by the target application. A control that changes only pixels without accessibility or text changes can still require a caller-provided postcondition or a future provider-specific visual assertion. The public Computer schema does not yet expose a target-window ID, so the Core service derives the current visible target from the provider observation.
