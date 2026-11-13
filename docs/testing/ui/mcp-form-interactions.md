# BUG-20261113-F04-008: Enter in a form editor accepted untouched defaults

- Scope: App/Desktop MCP form dock (shared App component).
- Observed: Focusing `Name` and pressing Enter implicitly submitted the entire native HTML form with its defaults. This differed from the TUI's field navigation and made accidental acceptance easy.
- Expected: Enter in an input advances focus to the next enabled input or select. Enter in the final input focuses Submit; accepting still requires activating that button. IME confirmation stays in the editor. Existing explicit buttons and Escape cancellation continue to work.
- Reproduction: Start the real form fixture, focus the default `Name` editor and press Enter. The new browser regression failed on the reviewed build while waiting for focus on `Quantity`, because the old form had submitted and closed. The completed peer result independently confirms `accept` with the original deployment defaults; the failure is not inferred from missing focus alone.
- Root cause: The dock's native HTML form retained implicit input submission, while its key handler intercepted only Escape.
- Fix: Intercept non-composing Enter from inputs, prevent implicit submission and advance focus through enabled form controls, falling back to Submit. Preserve native select/button activation. Repeated Enter events in an input do not keep advancing focus.
- Verification: `bun script/mcp-forms-ui.mjs browser` and `bun script/mcp-forms-ui.mjs builtin` from `packages/apexo` exercise text/numeric input navigation while the same backend request stays pending, a simulated composing Enter that leaves focus unchanged, last-input focus on Submit, explicit keyboard acceptance and the exact completed tool reply. Final results are recorded in [the implementation checkpoint](../../development/f04-implementation.md).
- Occurrences: One audit observation, reproduced by the pre-fix browser regression. No historical recurrence is inferred.

# BUG-20261113-F04-009: Constraints appeared above their owning field label

- Scope: App/Desktop MCP form dock.
- Observed: The minimum/maximum hints rendered above `Ratio`, visually associating them with the previous field.
- Expected: A field's title precedes its constraints and editor, as in the TUI.
- Reproduction: Open the deployment form and inspect the label and bounds for `Name`, `Quantity`, `Ratio` and `Regions`.
- Root cause: The constraints loop preceded the label in each field container.
- Fix: Render the existing label before the existing constraints loop, preserving all validation, copy and types.
- Verification: The production browser/Desktop acceptance checks that each displayed hint's bounding rectangle starts below its own label. Screenshots and the same exact typed wire-result assertions cover the completed flow. Final gate results are in [the implementation checkpoint](../../development/f04-implementation.md).
- Occurrences: One verified layout observation; no recurrence rule is inferred.
