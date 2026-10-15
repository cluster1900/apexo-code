# BUG-20261015-238: Scheduler UI assertions confused changed state and wrapped prose

- Status: All documented fixture corrections verified privately.
- Scope: Initial real browser locale and 80-column mini-terminal acceptance. One authoring episode with separately identified assumptions; these are not counted as same-root-cause recurrences.
- Observed: English Resume/Pause completed, then the Chinese screenshot step timed out waiting for `restart_required`. The mini fixture timed out on a whole-sentence substring although its final frame visibly showed the entire manager across two lines.
- Expected: Assertions follow actual state transitions and rendered terminal wrapping, while action readiness remains exact.
- Causes: Explicit Resume/Pause correctly replaced the restart reason on the same intent subsequently reused by the locale assertion. The prose-presence check assumed an unwrapped line at 80 columns.
- Fix: Keep the restarted intent unchanged through the locale screenshots and exercise control transitions on the separate active intent. Normalize whitespace only for the prose-presence assertion; preserve exact selected IDs, action enabled colors/pending state, HTTP assertions, and retained terminal frames.
- Verification: Corrected browser en/zh/zht acceptance passed seven checks with seven provider calls. Mini 80×24 and fullscreen 80×24/120×40 management checks passed. No production repair is claimed, and deadlines are unchanged.

## Final provider-count assertion

The same new fixture authoring episode later exposed a distinct readiness assumption in Desktop acceptance: the schedule receipt was visible immediately after the tool, before the parent follow-up provider turn had settled. The immediate final count saw one request rather than two. This is not an independent same-root-cause recurrence of the locale or wrapping mistakes.

After observing the schedule receipt, the fixture now uses the canonical bodyless Session wait to join the active parent drain before inspecting final provider calls. It does not add a prompt, repeat the UI action or extend the existing 20-second bound. The corresponding terminal fixture uses the same settlement boundary. The corrected browser and rebuilt native-window locale runs each passed seven checks with seven calls. The terminal settlement assertion uses the same canonical bodyless API; the prior terminal five-check runs already completed with seven calls.

## Fullscreen consent receiver readiness

The new explicit-consent case initially sent Enter when the underlying permission pane already displayed `Allow once`, but the Tasks dialog was still present after Escape. No permission reply was sent. The final frame and HTTP log identify a fixture receiver/readiness assumption, not a permission implementation failure.

The fixture now observes that the exact Tasks dialog text has disappeared after Escape before sending one Enter. It does not sleep, repeat the key or extend the deadline. Corrected fullscreen and mini permission runs each passed one real consent check with five setup provider calls and zero additional calls. This is a separate assumption within this authoring episode, not a new recurrence of the locale, wrapping or provider-count causes.

## Feedback image CLI provider settlement (2026-10-15)

A second independent instance of the provider-settlement assumption occurred in the new compatibility CLI Feedback image probe. Its prompt helper returned when `send_feedback` completed, before the normal follow-up assistant turn finished. The larger HTTP image-bound checks exposed a final provider-count assertion of two versus the earlier snapshot of one. Native probes already used the bodyless Session wait and were unaffected. This is fixture readiness, not a new image-management provider invocation.

The compatibility probe now observes the completed follow-up assistant message with the exact expected text and then the Session's idle status before snapshotting provider calls. It does not sleep, repeat the prompt, extend a deadline or weaken the final count. `bun script/grok-feedback-images.mjs cli` passed all six scenarios after the correction, including process death/reopening and unchanged provider count during operator management. These two settlement episodes are separate from the unrelated locale, wrapping and consent-receiver assumptions above; no recurring constraint is promoted from them.
