# BUG-20261015-147: Native terminal PTY interaction expectations

- **Scope:** One authoring episode for the native mini/fullscreen interaction acceptance script. No permission or cancellation product failure is claimed.
- **Observed:** The first fullscreen permission check timed out while the real UI displayed “Permission required”, “Shell command”, and the exact command. The fixture had searched for the tool description, which is not the permission heading. The original request remained pending. A Stop check also captured zero calls before the initial provider turn had reached the held command, then incorrectly compared that baseline with one call.
- **Expected:** Assert the actual permission presentation and original request identity. For cancellation, establish that the owned command is running before comparing provider counts.
- **Fix:** Wait for the permission heading and exact command, validate the pending original request ID, then approve. For Stop, wait for the held tool transcript, require exactly one initial provider call, and verify cancellation causes no continuation.
- **Verification:** From packages/apexo, `bun script/grok-native-terminal-tui.mjs --permission` and `--permission --fullscreen` each passed 3 checks / 3 provider calls. `--stop` and `--stop --fullscreen` each passed 1 check / 1 provider call. All PTYs and servers were reaped.
- **Additional fresh-fixture readiness:** Visible mini footer chrome precedes its asynchronous input queue setup. A fresh-session script initially pressed Enter too early; the existing footer refused the input and restored the draft. The fixture now waits for actual passive native bootstrap requests. This is not evidence of a model failure or lost durable input.
- **Tasks-route extension:** The initial extra route check incorrectly waited for the fullscreen running-tool heading in mini, whose restored transcript showed completed output and a live Tasks count instead. Fullscreen also required the normal second Enter after selecting `/tasks` from autocomplete. The fixture now establishes those actual presentation/readiness states before asserting the same live manager and unchanged provider count. The corrected mini/fullscreen routes each passed 2 checks with no manager-induced provider calls. These corrections do not claim a Task runtime repair.
- **Occurrence count:** One script-authoring episode with distinct expectation mistakes; no recurrence promotion.

## Shared integration verification

The integrated eleven-file Memory/terminal gate passed 96 tests / 371 assertions, and all 21 workspace typechecks passed. The actual shared mini/fullscreen matrix passed fresh creation, Plan, reconnect, permission, Stop, media paths, managed-child viewing, Tasks management and compatibility regression. The two initial permission-fixture backend startup timeouts remain a separate unresolved investigation (BUG163); unchanged single-mode reruns passed. All owned runs were reaped.

## Independent native-local Stop fixture occurrence

The local terminal acceptance script independently waited for the Bash `description` field as its readiness marker. The captured mini terminal instead displayed the exact command, including `local-stop.pid`, and its active interrupt control. The fixture timed out before pressing Escape; no product cancellation failure was established. This repeats the original tool-description-versus-rendered-presentation assumption in a second authoring episode. It does not turn the other expectation mistakes above into independent recurrences.

The script now waits for the actual command transcript and the command's written PID before pressing Escape, then requires that process to be reaped and no provider continuation to occur. `bun script/grok-native-local-terminal.mjs --stop` passed five checks / two provider calls: one original held turn and one separate user prompt after cancellation. The timeout and subsequent assertions are unchanged.

The corrected fullscreen local Stop case also passed five checks / two provider calls, with the same process-reaping and no-continuation assertions. Both local terminal processes were reaped.
