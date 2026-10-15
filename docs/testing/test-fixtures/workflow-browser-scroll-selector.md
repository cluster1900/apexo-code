# BUG-20261014-119: Copied browser fixtures retained the prior panel selector

- Scope: Workflow and Scheduler production-browser acceptance fixtures; two independent episodes.

## Workflow episode

- Observed: the confirmation button was below the visible nested-scroll viewport and agent-browser rejected its click as covered.
- Expected: scroll the real panel to an action before clicking it.
- Reproduction: start, resume, pause, and confirm stopping a run in the Workflow dialog.
- Root cause: the copied fixture's pre-click scrolling helper still matched side-question selectors instead of Workflow selectors.
- Fix: match Workflow action selectors in the existing scroll-into-view helper.
- Verification: the corrected bundled-browser and native fixtures each passed eleven checks, including confirmed stop.

## Scheduler episode

- Observed: the real Scheduler browser locale flow reached its below-viewport Resume action, but the click failed hit testing because the nested panel had not scrolled it into view.
- Root cause: the copied helper recognized Task and Process action selectors but excluded new Schedule selectors. This is the same stale selector whitelist mistake as the Workflow episode.
- Fix: apply the existing bounded scroll, stable geometry, enabled-state and hit-target checks to every fixture click/download selector, rather than maintaining a feature-name whitelist. No DOM event dispatch or repeated keypress substitutes for the real click.
- Verification: `bun script/grok-native-scheduler-ui.mjs browser --locales` passed seven checks with seven fixture provider calls, including real en/zh/zht actions and the ordinary `/loop` prompt path. The rebuilt native-window `native --locales` run also passed seven checks / seven calls with the same stable hit-target helper.
