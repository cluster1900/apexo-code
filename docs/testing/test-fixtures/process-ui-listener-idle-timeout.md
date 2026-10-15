# BUG-20261015-146: Process UI listener expired at the bounded wait deadline

- **Status:** Fixed and verified in the private acceptance fixture.
- **Occurrences:** One fixture-authoring episode.
- **Scope:** The native-only HTTP listener created by `grok-process-ui-fixture.mjs`; no production listener or Process lifecycle code changed.
- **Observed:** The actual native window issued the Process wait POST, but it ended with status 499. The expected timed-out result never rendered; the selected detail disappeared during transient request failures. The owned server log explicitly reported `[Bun.serve]: request timed out after 10 seconds. Pass idleTimeout to configure.` The native event stream also reported repeated failures. This was not a missing click: the wait request was present in the HTTP trace.
- **Expected:** A deliberately bounded ten-second Process wait returns its ordinary result while the fixture permits long-lived event streams. Transport idle expiry must not race the operation's own deadline.
- **Root cause:** The new fixture used Bun.serve's default ten-second idle timeout. Its duration collided with the UI's ten-second wait and also expired quiet SSE connections.
- **Fix:** Set `idleTimeout: 0` only on this owned fixture listener. Keep the UI wait body at 10000 milliseconds, the client's 15-second deadline, selection/close cancellation, and explicit fixture teardown. The correction does not add production retries or weaken a timeout assertion.
- **Verification:** From `packages/apexo`, `bun script/grok-native-process-ui.mjs native --locales` passed all seven checks with 16 setup provider requests and no additional provider work. The actual wait returned timedOut while the same Process remained running; closing a later wait cancelled only its HTTP request. English, Simplified Chinese and Traditional Chinese receipt screenshots plus 640-pixel geometry were inspected. The native process and owned server were joined, and no processes with their exact fixture profile remained.

The successful rerun is supported by the explicit before-run listener timeout diagnostic and the narrowly changed listener setting. It does not attribute unrelated connection resets to this cause.

Shared verification: App adapter 24 tests / 89 assertions and all 21 typechecks passed. Shared production browser and actual rebuilt Desktop window each passed seven checks / 16 setup calls, with zero additional provider calls from UI actions; compatibility regression passed. All owned commands exited zero and were reaped.
