# BUG-20261014-267: A bare Escape merged with the following Home key in the PTY fixture

- **Scope:** Native Goal PTY fixture navigation from report files back to progress.
- **Status:** Verified fixed with the installed parser and compact/expanded PTYs.
- **Observed:** The first compact run rendered actual task progress and verified
  report hashes, then timed out waiting for the completion summary after leaving
  the report list. Its composed screen still showed `Report files`.
- **Expected:** Escape closes the report list; a subsequent Home key scrolls the
  Goal status panel to its beginning.
- **Reproduction:** Feed a bare Escape immediately followed by Home (`ESC ESC [ H`)
  to the installed OpenTUI `StdinParser` with Kitty keyboard handling enabled.
  Inspect the emitted key events, then exercise the same sequence in the PTY.
- **Root cause:** The new reveal helper sent Home before the bare Escape had been
  disambiguated. The real parser emitted one meta/alt Home event and no Escape,
  so report navigation never occurred. This is an input-fixture defect, not a Goal
  state or scrolling failure.
- **Fix:** Send the unambiguous Kitty Escape sequence `ESC [ 27 u`, already used
  by the actual mini/fullscreen fixtures, before Home. Preserve real keyboard
  navigation and the original viewport sizes.
- **Verification:** A direct run of the installed `StdinParser` confirmed bare
  Escape plus Home emits one meta Home, while Kitty Escape plus Home emits separate
  Escape and Home events. `bun script/grok-native-goal-tui.mjs` and the same command
  with `--fullscreen` each passed nine checks, including progress visibility,
  report-hash preservation, report navigation and returning to the summary.
  The parser evidence establishes the cause independently of the passing reruns.
