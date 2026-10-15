# BUG-20261014-157: Terminal fixtures sent actions before pending work settled

- Status: Verified across three independent fixture authoring episodes; Process amendment integrated; shared pure and packaged fullscreen checks passed.
- Scope: real Hook, Plugins, and Process management terminal acceptance fixtures.
- Constraint: [RULE-20261015-015](../../rules/terminal-action-readiness.md).
- Observed: both modes displayed generation 1 metadata, then timed out waiting for generation 2. The captured ANSI stream showed the preceding refresh's loading state; no reload waiting state or API failure appeared.
- Expected: the fixture sends the next keyboard action only after the preceding refresh is idle, as required by the panel's pending-action guard.
- Reproduction: immediately send `r` followed by `l` while using already-visible generation 1 text as the completion condition for refresh.
- Root cause: stale rendered metadata satisfied the fixture's predicate before the new refresh finished. Reload was correctly ignored while a request was pending.
- Fix: wait for captured metadata with no loading state, and remove the redundant refresh immediately before reload. The raw read-only API still confirms that editing the source does not mutate the captured registry. Save the composed terminal screen before process teardown so failures preserve the visible panel.
- Verification: `bun script/grok-hooks-tui.mjs` and `bun script/grok-hooks-tui.mjs --fullscreen` from `packages/apexo`, pinned Bun 1.3.14, each passed seven checks. Both verify passive open, uncaptured reload guard, metadata refresh, command secrecy, explicit reload, unchanged model request count, and passive reopening. Fixture children were cleaned up. No production behavior changed for this fixture correction.

## Native Plugins harness recurrence

The expanded native Plugins harness later waited for the catalog's enabled label, then immediately sent Apply. Catalog state is rendered before its passive runtime refresh completes, while the shared panel intentionally ignores keyboard operations during pending work. The run timed out with generation 1 and the plugin enabled but not active. This is the same fixture readiness mistake: wait for both the desired data and disappearance of the pending indicator before sending another action. The native Plugins harness now waits for `Working…` to clear before every Apply, including recovery. Corrected compact and expanded reruns each passed all six native-action checks and were reaped. This was the second independent occurrence; the third Process occurrence below establishes the linked recurring constraint.


## Process wait completion recurrence

The real fullscreen Process acceptance fixture independently timed out at `second wait starts`. Its captured terminal still displayed the first wait's completion text, and the HTTP trace contained only the first Monitor wait. This was initially an observation, not proof of a product wait defect.

The actual fullscreen implementation sets completion text, awaits a passive list/detail refresh, then clears its pending-action guard in `finally`. `DialogSelect` renders a disabled Wait title and shortcut in the same muted foreground. A held-response proxy in the private acceptance fixture deterministically suspended the post-wait process-list read. While the first wait's completion text was visible, the rendered title and shortcut both had foreground `[50331648, 9803152]`, exactly one wait response had occurred, and one refresh request was held. Releasing that read changed the title foreground to `[50331648, 15658731]` while the shortcut stayed muted. Only then did the fixture send the next single shortcut; the second wait started and settled after actual joined cancellation.

The root cause is the same readiness mistake as the prior two episodes: visible result data was treated as proof that the action guard had settled. The product correctly rejects actions while pending. The fixture now waits for the actual rendered enabled Wait action. Optional `--wait-readiness` adds the deterministic held-refresh proof and saves both states. It adds no delay, retry keypress, or product behavior change.

Verification from `packages/apexo`, pinned Bun 1.3.14: `bun script/grok-native-process-tui.mjs --fullscreen --wait-readiness` passed seven checks with 21 setup provider calls and zero UI provider calls. This includes live Monitor/Shell output, passive timeout, second wait settlement, joined Shell cancellation, independent source-error recovery, and restart receipt inspection. The actual terminal frames, ANSI stream, HTTP trace, and foreground-state JSON were inspected. All owned terminal, provider, proxy, and backend processes were closed and reaped. This is private source-backed terminal evidence; packaged/shared integration is not claimed by this run. No scenario deadline was increased. The proposed separate BUG-20261015-214 was left unused.

Shared verification subsequently passed the held-refresh fullscreen command with seven checks and 21 setup calls, plus `--fullscreen --desktop --narrow` with five checks and 21 setup calls. Both added zero UI provider calls, exited zero, and reaped their owned processes. The fixture-only correction preserves the previously accepted production artifacts.
