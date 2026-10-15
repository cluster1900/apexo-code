# Mini footer dropped partial Task list failures

- **Bug ID:** BUG-20261015-198.
- **Scope:** Private native Shell/Monitor manager UI, mini footer state projection and terminal manager titles.
- **Observed:** Actual process-list HTTP 503 left the surviving subagent row visible, but the source warning disappeared and the manager showed zero running. The adapter returned the failure correctly.
- **Expected:** Keep the surviving domain, display a fixed safe source warning and an unknown running total, then clear the warning after recovery.
- **Root cause:** The explicit footer stream-patch merge omitted the new optional `taskIssues` field. Manager titles also computed a subtotal without qualifying the partial response.
- **Fix:** Preserve/replace `taskIssues` in the existing footer state merge; render `? running` in either terminal manager while a list/error is incomplete. No raw error causes or new transport are introduced.
- **Verification:** The first real mini rerun after the merge passed six checks with zero UI-provider calls, including each independent list failure and recovery. Final 80×24 mini and fullscreen each passed six checks with zero UI-provider calls. The actual frames show the fixed source warning, surviving domain and `? running`; subsequent recovery removes the warning.

Review also aligned the manager count paragraphs/titles with the existing unknown-count tooltip convention when either source is unavailable. The production-browser partial-failure check verifies `Running in this list: ?`. This is not counted as another occurrence of the footer merge omission.
