# BUG-20261015-044: Workflow recovery screenshots omitted the asserted content

- **Status:** Fixed and verified. One fixture-authoring episode; no recurring rule.
- **Scope:** Production browser and native-window Workflow evidence capture.
- **Observed:** Both initial runs passed 16 DOM/API checks, but the localized screenshots showed the top of the source form. The recovery card was below the nested dialog viewport. The images could not establish visual readability of the asserted text.
- **Expected:** Evidence screenshots must show the recovery text, token total, and lower-bound hint being reviewed.
- **Reproduction:** In `packages/apexo`, run `bun script/grok-workflow-ui.mjs desktop --locales` or `native --locales` with screenshots immediately after DOM text assertions and no explicit reveal of the recovery card.
- **Root cause:** DOM content assertions were treated as sufficient screenshot framing. Locale reload restores the form's initial scroll position; waiting for text does not scroll to it. This is distinct from a failed off-screen click or asynchronous product scroll readiness.
- **Fix:** Scroll the actual blocked-resume element into view before the English and both Chinese screenshots. Runtime assertions and product code are unchanged.
- **Verification:** Both corrected commands passed 16 checks and exited successfully. All six recovery screenshots were inspected: token total 120, lower-bound hint, and new-run guidance are readable; Resume is absent. The initial successful assertions are not counted as successful visual review.
