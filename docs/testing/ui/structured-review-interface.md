# Structured code review interface regressions

## BUG-20261112-008: Mini review route retained composer geometry and bindings

- Scope: the native mini terminal's `/review` route.
- Observed: opening the review rendered only its first rows; composer bindings remained eligible while the panel was open.
- Expected: the review owns the existing action-panel height and keyboard lane until closed.
- Reproduction: attach with `--mini`, enter `/review`, and inspect the report controls in a real PTY.
- Root cause: the new route was missing from the footer height, inactive-route and composer-binding inventories.
- Fix: register `review` in those existing inventories and the local slash-command list.
- Verification: `bun script/code-review-tui.mjs` passed eleven checks with an actual attached mini terminal, including opening, report navigation, focus editing, reopening without provider calls and targeted cancellation.

## BUG-20261112-009: Fullscreen report controls exceeded the dialog viewport

- Scope: the fullscreen terminal review dialog.
- Observed: the priority and close hints fell below a 40-row terminal.
- Expected: report controls and enabled/idle state remain visible within the existing dialog placement.
- Reproduction: open `/review` in a 120-by-40 fullscreen PTY.
- Root cause: the initial review height subtracted only eight rows, while the shared dialog starts one quarter of the screen below the top.
- Fix: bound review height by the available dialog space, retain a stable outer box and offer PageUp/PageDown for captured evidence.
- Verification: `bun script/code-review-tui.mjs --fullscreen` passed eleven real PTY checks, including priority selection and cancellation after an explicitly observed ready state.

## BUG-20261112-010: Starting a second terminal review retained the previous selection

- Scope: terminal review history selection.
- Observed: refreshing after a new admission could preserve the previously selected report ID.
- Expected: the newly admitted review becomes selected, including when a prior report already exists.
- Reproduction: finish a review, set a new focus, then start a second review.
- Root cause: list reconciliation preserved the old selected ID before incorporating the returned admission.
- Fix: incorporate the admitted report before the authoritative refresh; retain loaded history pages across progress refreshes.
- Verification: mini and fullscreen PTY acceptance both created and cancelled a second review while preserving the completed first report.

## BUG-20261112-011: Initial machine finding selection was lost before diff readiness

- Scope: shared asynchronous diff preview, reached by the App and Desktop review panel.
- Observed: a finding's validated line range arrived before the diff instance existed and did not receive a line highlight. Clicking findings still selected the file, so a file-only assertion missed the defect.
- Expected: the first validated range is highlighted after rendering; selecting a file-level finding clears the highlight.
- Reproduction: start a native review, click its first in-hunk finding before its file preview has initialized, then inspect the actual diff's selected-line attributes.
- Root cause: the shared diff selection setter returned before storing the pending selection when its asynchronous instance was absent; the render-ready path also reapplied mutable cached selection instead of the supplied controlled range.
- Fix: retain the requested range before the instance-readiness guard and reapply the authoritative controlled range through the existing render-ready path. Machine findings remain separate from editable comments.
- Verification: `bun script/code-review-ui.mjs browser` and `bun script/code-review-ui.mjs native` each passed eleven checks on the repaired production builds, including actual selected-line attributes and their removal for a file-level finding.

## BUG-20261112-014: A new App admission could retain the previous report fields

- Scope: App/Desktop starting another review while a completed report is selected.
- Observed: code inspection found that the new admission changed the selected ID without clearing the previous detail object before Solid store merging.
- Expected: a running review must not display a preceding review's summary or evidence.
- Reproduction: complete one review, start a held second review and inspect the running report before cancelling it.
- Root cause: partial store object updates preserve omitted optional fields; the prior detail could be merged with the new run before its own result existed.
- Fix: clear the detail object at the new admission boundary, matching history selection's existing reset.
- Verification: the explicit no-prior-summary assertion passed in both production browser and rebuilt Desktop acceptance (twelve checks each). This record distinguishes the code-inspection finding from a separately observed pre-fix runtime reproduction.

## BUG-20261112-016: Review slash aliases diverged across surfaces

- Scope: App command registration and the mini footer's generic slash fallback.
- Observed: the full aggregate gate failed the Desktop/CLI parity check because `reviews` existed only in the terminal. It also failed the existing minimal slash regression because the initial integration incorrectly classified `/review main` as a fullscreen-only command.
- Expected: `/review` and `/reviews` open the report UI on all four surfaces; unhandled argument-bearing slash text retains its existing route.
- Reproduction: run `bun test test/parity/slash-commands.test.ts test/cli/run/footer.slash.test.ts` in `packages/apexo` on the initial interface integration.
- Root cause: the App registration omitted the alias, and the integration added review names to a fullscreen-only fallback inventory despite implementing a local mini action. The first alias PTY check also found that mini autocomplete must advertise `reviews` explicitly; otherwise Enter could select a different fuzzy-matched command before local submission.
- Fix: register the App alias, advertise both names in mini autocomplete, and remove those names from the fullscreen-only fallback. The actual mini `/review` and `/reviews` routes still run locally before fallback classification.
- Verification: the focused parity/slash command passed five tests / 31 assertions. Mini/fullscreen PTYs passed eleven checks each, including reopening through `/reviews`; production browser and rebuilt Desktop each passed thirteen checks, including typing the alias with no new provider call. No exemption was added to the parity test.
