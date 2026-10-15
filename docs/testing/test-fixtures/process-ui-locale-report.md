# BUG-20261015-215: Process UI acceptance report overstated its locale scope

- **Status:** Corrected report; explicit shared browser and native-window locale runs passed.
- **Scope:** The native Process manager browser/window acceptance script. One reporting-authoring episode, not a product localization defect.
- **Observed:** Invocations without `--locales` exercised English only but printed a successful check named `three-locale-terminal-receipts-truncation-restart-and-task-output`. The retained screenshots contained English only.
- **Expected:** Reports must name exactly the locales actually exercised. Three-language acceptance requires an explicit run covering `en`, `zh` and `zht`.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-native-process-ui.mjs browser --overload` without `--locales` and compare the report with the selected locale loop and retained screenshots.
- **Root cause:** An unconditional check label described the optional full matrix rather than the selected invocation scope.
- **Fix:** Define the selected locale list once, use it for iteration and the successful check label, and include it in the result. Compatibility reports an empty locale list because it does not execute this native localization matrix.
- **Verification:** `node --check script/grok-native-process-ui.mjs` checks the changed script. Explicit shared browser and actual-window runs with `--overload --locales` each passed eight checks, with en/zh/zht screenshots retained and inspected; setup/Monitor-event provider calls were 47 and 49 respectively, and UI actions added zero. These runs started before the report-only edit; their explicit invocation and screenshot evidence establish the actual locale scope. Earlier default runs are counted as English-only even though their old labels overstated coverage.
