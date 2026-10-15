# BUG-20261015-163: Permission acceptance backend readiness timed out

## Shared socket LSP acceptance observation

The first shared `bun script/grok-lsp-socket-native.mjs cli` attempt also exceeded the unchanged 30-second initial backend-readiness deadline and exited 1 before the scenario started. This is an unresolved startup observation, not a socket transport failure or proof of the earlier timeout's cause. The shared fixture now includes its evidence-directory location in the thrown startup error after owned cleanup, so concurrent isolated fixtures can be distinguished reliably. No timeout was increased and no production repair is claimed.

- **Status:** Investigating; no product fix or confirmed root cause.
- **Scope:** Initial source-server startup in the shared mini/fullscreen permission acceptance fixtures.
- **Observed:** Both permission commands in one parallel matrix invocation exceeded the existing 30-second `backend readiness` bound. Each backend log contained the unsecured-server warning but no listening banner. The isolated application logs recorded global configuration loading without a later startup milestone. The native-only fixture server and terminal interaction had not started.
- **Expected:** The fixture-owned source backend starts, is replaced by the owned native-only host, and the actual terminal restores and approves the original permission request.
- **Reproduction:** Run `bun script/grok-native-terminal-tui.mjs --permission` with and without `--fullscreen` from `packages/apexo`. The failed matrix launched the two modes together while an HTTP gate and other independent work were active. No evidence establishes concurrency or configuration as the cause.
- **Root cause:** Unknown. This is distinct from BUG147's incorrect visible permission selector: neither failed command reached the terminal UI. Two observations in this invocation do not establish two independent occurrences of a known root cause.
- **Cleanup:** Both failed fixture commands completed their owned backend/provider cleanup and exited with status one. No matching backend child remained after the runs.
- **Investigation:** An unchanged mini rerun passed three checks / three provider calls, including restored approval and a second durable prompt. No source, timeout, configuration or assertion was changed. This passing rerun does not establish a repair. Further matrix results are recorded separately.

The unchanged fullscreen permission rerun passed three checks / three calls. The remaining Stop, media, child-view, Tasks-manager and compatibility matrix groups passed in both modes, and every owned command exited zero and was reaped. No production or fixture source was changed for those reruns. The original startup observations remain unresolved.

## Native Memory window setup observation

The private native Memory window command (`bun script/grok-native-memory-ui.mjs native --locales`, from `packages/apexo`) later exceeded the same 30-second initial source-backend readiness bound. Its backend log was empty and its provider-call ledger was empty. The native-only replacement server and Electron window had not been created. Owned cleanup completed and the command was reaped with exit one.

This observation is retained alongside the same setup symptom, not counted as another verified occurrence of a common root cause. No evidence identifies why this startup did not reach its listening banner, and no timeout or production behavior was changed. The isolated native-window rerun passed sixteen checks across en/zh/zht with five setup provider calls and zero UI calls. The initial startup bound and source were unchanged. This successful rerun does not establish a fix for the original observation.

## Native local fixture setup observation

The first native-local interactive acceptance attempt also exceeded the unchanged 30-second initial compatibility-backend readiness bound before starting the native local terminal. The fixture had unnecessarily launched that compatibility backend even though this test owns its own local native host. Its backend log stopped before listening; no terminal or model work had begun. The root cause of the startup delay remains unknown and is not counted as another proven recurrence.

The fixture now supports an explicit provider-only setup option for local-host acceptance; existing callers retain the original setup. Removing an unused server from this scenario is a fixture scope improvement, not a repair of the unexplained server startup. Native-local terminal startup observations after that change are recorded separately in [BUG-20261015-180](native-local-empty-startup.md).

## Shared Scheduler restoration setup observation

The first shared `bun script/grok-scheduler-restore-native.mjs cli` run exceeded the unchanged 30-second initial backend-readiness bound while the workspace typecheck gate was active. Both its backend and application logs were empty, and the provider-call ledger was empty. It had not created a Session or exercised restoration. The fixture completed owned backend/provider cleanup and exited one; no fixture backend remained. This is another unresolved setup observation, not proof that typechecking caused the delay and not an additional verified recurrence of a known root cause.

After the typecheck command exited, the unchanged source CLI command passed all four checks with eleven provider calls, including process kill/reopen, passive reads, retained manual/Stop pauses, unknown unfinished-owner refusal and one real future cadence tick. No timeout, source, configuration or assertion was changed. The successful rerun verifies the functional scenario but does not fix or explain the earlier startup delay.

## Native Memory operations setup observation

One private `bun script/grok-native-memory-operations-tui.mjs --fullscreen --narrow` invocation exceeded the unchanged 30-second initial backend readiness bound before the terminal was created. Owned bounded cleanup completed. No common root cause is established and this is not counted as a verified recurrence. No timeout increase or product repair is claimed; later UI verification remains separate from this startup symptom.

## Automatic legacy Memory source acceptance observation

Two serial source CLI acceptance invocations during the B1 private verification each exceeded the unchanged 30-second initial backend-readiness bound. Their backend logs were empty. Neither reached Session creation or provider work, and owned cleanup completed. Multiple independent builds and typechecks were active on the host; that is context, not a proven cause. No startup deadline or production behavior was changed. A later serial functional run is recorded with B1 evidence; passing it does not establish a repair of these startup observations.

The socket probe repeated the same initial deadline with an empty owned backend log. After the concurrent typechecks finished, the same CLI scenario passed five checks / six provider calls without a deadline change. These timings are observations, not proof that machine load caused either failed startup.
