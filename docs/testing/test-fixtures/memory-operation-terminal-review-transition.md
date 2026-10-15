# BUG-20261015-298: Terminal fixture reused the prior clear review frame

- Scope: Native Memory operations mini/fullscreen acceptance.
- Observed: The fixture sent Back, immediately matched the previous Ready header and clear preview, and then sent a confirmation while a fresh preview was pending. No recovery POST was admitted; the final terminal frame showed a preview without confirmation.
- Expected: Each action is sent only after the prior transition and the exact next action's readiness are observable.
- Root cause: Ready alone did not prove Back had been processed. The old preview and confirmation could satisfy subsequent assertions before terminal input was handled.
- Fix: After Back, require both the recovery preview and irreversible confirmation to disappear with Ready visible before issuing a new preview. The later confirmation is therefore from the new preview.
- Reproduction: Complete Dream and carryover, preview clear, review, Back, then immediately request and confirm another clear.
- Verification: Real mini/fullscreen at 120×40 and 80×24 passed all nine checks with three provider calls per run, including Back preserving the topic and a fresh explicit confirmation admitting one clear.

The narrow mini run also observed Ready before the first asynchronous receipt list arrived. The fixture now waits for the actual capture row as well as Ready. Clear confirmation readiness now uses an explicit visible header state before scrolling its below-fold detail, avoiding scrolling the prior layout frame. These are supporting readiness corrections, not new verified recurrences.
