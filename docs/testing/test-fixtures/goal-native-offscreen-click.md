# BUG-20261014-017: Native Window Fixture Clicked Button Outside Viewport

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: `grok-goal-native.mjs` driving Electron via CDP (`agent-browser`).
- **Observed**: The target button center was at `y=812.3` in an 800px-tall window. Automated click did not scroll the button into the viewport first, causing `pointerdown`/`mousedown`/`click` to hit `<html>` and trigger Kobalte's outside-click dialog dismissal.
- **Expected**: Scroll the target into the visible viewport and verify that its center hits the target element before clicking.
- **Reproduction**: Run `bun script/grok-goal-native.mjs` in `packages/apexo` without explicit scroll-into-view before clicking lower dialog actions.
- **Root Cause**: Relied on implicit auto-scrolling during CDP click, which did not scroll inside the dialog container.
- **Fix**: Added a unified real-click helper that calls `scrollIntoView`, waits for bounding-box position stability, and verifies that the center point is inside the viewport and `elementFromPoint` hits the target before dispatching a real click.
- **Verification**: All 7 native window scenarios passed with hit-target verification and real file downloads.

## Plugins five-locale fixture follow-up (2026-10-14)

The Faroese activation notice made the Plugins catalog extend below the nested
Settings viewport. The fixture clicked a card and Settings disappeared before
its Download action could be found. The retained pre-click screenshot shows the
card below the visible scroll area; that run did not instrument the actual event
receiver, so it is not counted as another proven `<html>` click occurrence.

Source inspection found that the Plugins fixture's copied visibility helper
still matched `hooks` selectors, leaving plugin cards/actions unguarded. The
fixture now scrolls Plugins selectors into view and waits until their center
hits the target. Name-based actions also explicitly reveal their real button
before `agent-browser` clicks it. This changes test automation only. The corrected production browser and actual macOS native-window runs each
passed 13 checks across all five locales, including guarded card selection and
real download/install actions. A pass alone
does not establish the original event receiver.


## Native summary fixture follow-up (2026-10-14)

The new native-summary window fixture reported a successful Pause click, but the
server trace contained no pause request and its wait timed out. The final capture
was taken after releasing the worker in cleanup, so it cannot establish the
original hit target or whether the button was still disabled. Concurrent native
visual fixtures were running. This is an unresolved click symptom, not another
proven off-screen event-receiver occurrence.

The summary fixture previously scrolled without the stable-geometry/enabled/
hit-target gate used by the earlier verified fixture. It now uses that bounded
gate and captures failure layout before releasing held work. Native visual runs
are sequenced. A rerun is pending; successful acceptance alone will not establish
the missing original click's root cause.


A second summary run still missed Pause with enabled, stable pre-click geometry.
The captured bounds placed Pause at the earlier idle-state row; after the missed
click the report panel was open and Pause had moved to the later working-state
row. This rules out a simple disabled-button explanation but does not capture
the original event receiver. The fixture had waited for the backend's worker,
not for the polled UI to display that worker state. It now also waits for the
rendered Working label before Pause. The sequential native-window rerun passed
all eleven summary/report checks with the rebuilt artifact. The evidence supports
a fixture synchronization gap; the exact receiver of the earlier missed click
remains unknown, so those runs do not increase this record's proven off-screen
occurrence count.
