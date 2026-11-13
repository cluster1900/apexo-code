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

## BUG-20261112-019: Session protocol selection disabled review on capable mixed hosts

- Scope: App, Desktop and terminal review availability on the normal Apexo mixed host.
- Observed: the default Desktop backend and `apexo serve` exposed working review routes but the UI disabled review because their Session transport was V1.
- Expected: disable only hosts that lack the review capability. Mixed hosts keep their selected Session transport and can still run native structured review.
- Reproduction: connect the browser App to `apexo serve`, or launch a rebuilt Desktop with its own sidecar, then open Code review.
- Root cause: the feature equated the Session protocol discriminator with API capability. The earlier Desktop fixture selected an external native-only server and did not cover the default sidecar.
- Fix: use a shared SDK helper to probe the actual read-only review list route. App/TUI availability is independent of Session protocol. Add a mixed-host browser mode and a Desktop fixture mode that uses the rebuilt app's own authenticated sidecar on an isolated port.
- Verification: the final mixed-host production browser acceptance passes eighteen checks. Rebuilt Desktop own-sidecar acceptance also passes eighteen checks. A real HTTP SDK test confirms mixed health plus review support, 404/405 unavailability, authorization error propagation and GET-only probing.

## BUG-20261112-024: Passive review refresh blocked terminal actions

- Scope: mini/fullscreen review keyboard handling and report polling.
- Observed: every GET compared a fresh index against the whole workspace; the same pending flag then ignored navigation, start and cancellation keys during passive refresh. The external report measured about 1.33 seconds per GET on a 6279-file repository.
- Expected: ordinary status polling performs no workspace hashing and a held passive request does not disable cancellation.
- Reproduction: hold a running review in a large repository, block a passive list response and press cancel once.
- Root cause: volatile workspace comparison was implicit in every detail read, and background refresh reused the mutation-pending lock.
- Fix: require explicit `compareWorkspace=true` for comparison; UI requests it when inspecting completed evidence or at completion, while CLI/active polling uses plain reads. TUI passive refresh has separate state and an identity token so mutation/navigation invalidates stale refresh results. Immutable targets use a frozen-revision label rather than comparing an unrelated working tree.
- Verification: native tests assert that plain detail reads omit comparison and immutable targets return `not_applicable`. The final large-repository mini PTY passes fourteen checks, including a single cancellation key while its passive list response is held; the final fullscreen PTY passes the same fourteen checks. Twenty ordinary detail polls in a 6279-file fixture measured 0.623 ms median and 0.902 ms p95; explicit comparison took 1018 ms and detected a subsequent edit.

### 2026-11-13 audit follow-up to BUG-20261112-024: App/Desktop still block actions

- Priority: P2. Status at `adfce4ec`: terminal remediation verified, App/Desktop open. Corrected by the remediation below.
- Observed: in both the rebuilt production browser and an actual rebuilt Electron window, holding the passive review-list GET made Cancel review, Start review, Refresh reports and report history disabled while the selected review remained `running`. Releasing only that GET restored the actions, after which normal cancellation succeeded.
- Expected: background status reads must not prevent cancellation or history navigation. A held GET must not turn the review UI into an indefinite action lock.
- Reproduction: start a held second review with `startCodeReviewFixture`, obtain its ID before installing the hold, then call `fixture.pauseRefresh()` and inspect the real controls' `disabled` properties. Use the production UI flow from `code-review-ui.mjs`; the native reproduction uses its `native` mode with the controlled backend. Normal Desktop-own-sidecar acceptance is a separate passing check.
- Root cause: `CodeReviewDialog` still runs its three-second passive timer through `run`, which sets the mutation `pending` flag. That same flag disables all of these controls, and the request has only the dialog-lifetime abort signal. This is the same action-lock root cause as the terminal issue recorded above, not a new historical recurrence count.
- Fix: not applied during the audit. Reuse the already implemented terminal distinction between passive refresh and user actions, including stale-response fencing.
- Verification: one controlled browser run and one native-window run each observed all four controls disabled and then recovered by releasing the GET. [Native screenshot](assets/f01-refresh-disabled.png); [normalized evidence](../../development/f01-audit-evidence.json). This proves the lock without relying on a generic timeout or repeated clicks.

## BUG-20261112-025: Review UI reused side-question copy and retained a competing unrestricted command

- Scope: review action labels, terminal-state copy, command menus and target editing.
- Observed: App cancellation said `Cancel this answer`; a cancelled terminal review still said `Review in progress`; App offered the old generic `/review` alongside the new read-only entry. The terminal target editor inserted new text before its existing value.
- Expected: review-specific copy, truthful terminal status, one local structured-review command, and a cursor placed after the target value.
- Reproduction: cancel a review, type `/review` in the App, and open the terminal target editor before entering text.
- Root cause: borrowed side-question localization, a status-independent fallback, unchanged server-command filtering and the editor's default initial cursor position.
- Fix: add review-specific typed copy; route review/reviews to the registered structured action before generic server commands; filter the competing server entry from both composer menus; show terminal statuses and report target/time; move the target cursor to the end after mount.
- Verification: the final mixed-host browser acceptance confirms one read-only menu entry and correct cancellation copy. The final large-repository mini PTY confirms target replacement and cancelled-status copy. Final fullscreen PTY and own-sidecar Desktop checks confirm the same behavior.

## BUG-20261113-005: Fullscreen review PageDown dismisses the dialog

- Priority: P2. Status at the audited `adfce4ec` revision: open. Corrected by the remediation below.
- Scope: fullscreen review captured-evidence scrolling, especially visible in an 80-by-24 terminal.
- Observed: selecting an outside-hunk finding in an 80-by-24 PTY left its snippet below the viewport. Pressing the advertised PageDown control dismissed the entire review instead of revealing the snippet. A separate normal 120-by-40 PTY reproduced dismissal with one PageDown after the completed report and ready actions were observed; provider call count stayed at one.
- Expected: PageUp/PageDown scroll the review's own evidence and preserve the dialog. The underlying Session must not receive those shortcuts while the dialog owns interaction.
- Reproduction: run the real fullscreen PTY flow from `script/code-review-tui.mjs`, wait for a completed report and `Ready` actions, then send one PageDown (`\x1b[6~`). Observe the review disappearing and the composer returning. Smaller-terminal probes additionally show why scrolling is necessary.
- Root cause: the review registers only Escape through `useBindings`; PageUp/PageDown are handled through raw `useKeyboard`. The fullscreen Session's registered page commands remain eligible and call `dialog.clear()`. Existing Task and Goal dialogs already capture their scrolling keys with higher-priority modal bindings.
- Fix: not applied during this audit. Register review scrolling through the existing modal keybinding mechanism; do not redesign global keyboard dispatch.
- Verification: the focused normal-size PTY probe reproduced `PAGE_DOWN_DISMISSES_REVIEW` with one provider call, in addition to the smaller-terminal failure. The initial missing-snippet timeout alone was not treated as proof of a rendering defect. See [normalized evidence](../../development/f01-audit-evidence.json).

## 2026-11-13 remediation verification

- BUG-20261112-024, App/Desktop: passive refresh now has its own state and a response-generation token. Explicit actions invalidate older refreshes without waiting for their response. This reuses the terminal pattern; no generic state framework was introduced.
- Real browser/mixed-host and rebuilt Desktop-own-sidecar acceptance each pass 22 checks. The fixture holds only the passive GET, leaves other requests real, checks all four controls remain enabled, then actually cancels, selects history and starts another review before releasing that GET. Its late response cannot replace the new selection. Desktop delays the actual request at the owned Electron session network boundary, retaining the default sidecar and its authentication.
- BUG-20261113-005: PageUp/PageDown use the existing higher-priority modal bindings, ahead of fullscreen Session navigation. They scroll by the evidence viewport height. Long captured evidence proves visible scrolling, not merely absence of dismissal. Mini and fullscreen 120-by-40 checks pass 16 cases each; fullscreen 80-by-24 passes the same cases, including scrolling evidence that starts below the visible area.
- The earlier audit observations remain historical evidence for `adfce4ec`; they are not additional recurrence counts. The supplementary App `jsxDEV` unit-runner limitation remains unresolved.
