# BUG-20261015-243: Mini terminal rejected the newly supported loop command

- Status: Corrected and verified in the private Scheduler UI implementation.
- Scope: Native mini-terminal prompt admission; one integration episode.
- Observed: entering `/loop 1h ...` displayed “Native terminal user-shell and slash-command execution are not available”. The native HTTP trace contained no prompt admission or resulting schedule.
- Expected: the built-in `loop` command reaches the shared native transport's canonical command discovery and ordinary durable prompt admission. Other unsupported commands and user-shell mode remain rejected.
- Root cause: the mini stream adapter rejected every parsed `prompt.command` before calling the shared transport, whose new loop expansion had already been implemented and independently tested.
- Fix: exempt only the exact parsed `loop` command from this pre-admission guard. The shared transport still owns expansion, metadata validation, permissions and ordinary admission; no second template or executor is added.
- Reproduction: `bun script/grok-native-scheduler-tui.mjs` with a real native server/provider fixture and actual PTY input.
- Verification: the failed frame and HTTP trace establish the missing admission. The corrected command passed five real checks: five setup calls, zero passive management calls, and two parent provider calls from `/loop`, producing a real schedule. Fullscreen coverage and package types are recorded with the feature handoff.
