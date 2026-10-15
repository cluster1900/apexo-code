# BUG-20261015-118: Background Task screenshots did not reveal selected output

- **Scope:** Browser/native-window Task acceptance screenshots after adding multiple background lifecycles.
- **Status:** Fixture corrected; strengthened browser/native-window checks and visual inspection passed.
- **Independent occurrences:** One visual-review finding.

## Observation and expected behavior

The ten-check background UI run passed its text assertions, but the browser screenshot named for interrupted-task guidance showed only the enlarged task list. The selected guidance was below the visible scroll area. The long-output screenshot showed only a clipped beginning. DOM text presence and bounded dimensions did not demonstrate that the selected guidance and preview were actually painted within the captured panel.

## Cause and correction

The extended fixture adds idle, active and wait rows while retaining the older foreground screenshot sequence. It selected a row and captured a screenshot without revealing its output. The product panel remained scrollable; no product rendering defect was established.

The fixture now scrolls completed lifecycle output, restart guidance and the bounded output preview into view before capturing them. It checks actual center-point hit visibility for the guidance and ensures the preview bounds lie inside the visible panel. These checks supplement the existing content, localization, provider-count and scrollability assertions. Product source and performance artifacts are unchanged.

## Verification

The original browser and native-window runs each passed ten checks / 22 provider calls. Visual review of the English active row, Simplified Chinese interrupted screenshot and Traditional Chinese output screenshot exposed the evidence gap. The corrected commands are `bun script/grok-native-task-ui.mjs browser --background --locales` and the matching `native` mode, run from `packages/apexo`. Both strengthened runs passed ten checks / 22 provider calls and exited cleanly. The corrected browser Simplified Chinese interruption and Traditional Chinese output images, plus native English/Simplified Chinese interruption and Traditional Chinese output images, were inspected. Guidance and bounded output are visibly inside the panel. The separate earlier running-row screenshots retain mode-label evidence.
