# BUG-20261015-046: Workflow list growth collapsed fixed terminal rows

- **Scope:** Shared Workflow browser in mini and fullscreen terminals.
- **Status:** Fixed and verified in the actual component, both terminals, package types and rebuilt Desktop.
- **Occurrences:** One product defect, reproduced in the actual renderer and both earlier PTY captures. These are evidence for one defect, not separate recurrence counts.
- **Observed:** The Source line contained characters from the title above it. A longer list also mixed footer text with a result row. Earlier recovery assertions passed because their text remained present, but the whole panel was not cleanly rendered.
- **Expected:** Title, source, controls and footer retain their own rows while the run list scrolls inside the remaining height.
- **Reproduction:** `bun test test/cli/workflow-browser.test.tsx` from `packages/apexo` renders the real Workflow component with twelve runs and a fixed-height panel. The original implementation failed the intact-header assertion. This reproduces without xterm reconstruction or a browser capture.
- **Root cause:** The list viewport used its content height as its flex basis. Growing content competed with default-shrinkable header/control text, collapsing fixed rows to the same terminal coordinate. The symptom was not caused solely by the capture lifetime defect in BUG-20261015-045.
- **Fix:** Keep fixed text rows nonshrinking; give list/preview viewports a zero flex basis and zero minimum height so they consume the available space. Preserve the stable outer box and existing dialog lifecycle.
- **Verification:** The initial component test failed on the original implementation and passed after the layout change. Final renderer regression passed two tests / ten assertions at panel heights 19 and 26. Actual mini and fullscreen fixtures each passed fourteen checks, including intact title/Source text after list growth, prior budget/control interactions and schema recovery. Both retained screens were inspected. Apexo and TUI typechecks and the final Desktop build passed. The rebuilt Desktop schema acceptance passed five checks / nine provider calls again; installed reference schema behavior is recorded separately in the feature document.
- **Constraint:** No new rule; below the recurrence threshold. The existing stable-root constraint remains satisfied.

The following shared gate includes this repair: 4,036 unit tests passed, 19 existing skips, one todo, zero failures; all three HTTP modes passed 288 scenarios each. No new occurrence was observed.
