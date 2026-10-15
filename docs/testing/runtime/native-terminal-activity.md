# BUG-20261015-143: Native mini terminal activity did not return to idle

- **Scope:** Off-tree native terminal consumer; one verified implementation episode.
- **Observed:** Attaching to a native Session restored its pending Question. Approval completed the real provider turn and rendered its answer, but the footer retained a running phase and blocked the next prompt. The actual PTY and recorded native requests established completion; a later SSE close was not evidence of a provider failure.
- **Expected:** Passive attachment must reflect the process-local coordinator after completion, without submitting another prompt or inferring idle from an HTTP failure.
- **Cause:** The new native event projection supplied transcript changes but lacked coordinator activity reconciliation for a drain that the terminal did not start.
- **Fix:** Read native active ownership in a single, terminal-owned polling loop. Abort and join it on close. Do not treat failed reads as idle. Ignore a response superseded by a newer step/admission and do not clear an admitted local turn before its input is projected. Fullscreen uses the same canonical active endpoint with per-Session revision checks.
- **Verification:** From packages/apexo, `bun script/grok-native-terminal-tui.mjs` passed 3 checks / 3 provider calls: passive restored Question, real approval, and a second durable prompt. `bun script/grok-native-terminal-tui.mjs --reconnect` and its fullscreen equivalent each passed 4 checks / 3 calls, including reconnect without resubmission. Final frozen-source rerun is recorded in the feature document.
- **Occurrence count:** One. Failed observations and subsequent diagnostics belong to the same unrepaired episode.

## Shared integration verification

The integrated eleven-file Memory/terminal gate passed 96 tests / 371 assertions, and all 21 workspace typechecks passed. The actual shared mini/fullscreen matrix passed fresh creation, Plan, reconnect, permission, Stop, media paths, managed-child viewing, Tasks management and compatibility regression. The two initial permission-fixture backend startup timeouts remain a separate unresolved investigation (BUG163); unchanged single-mode reruns passed. All owned runs were reaped.
