# BUG-20261104-002: Desktop Titlebar Tab Horizontal Jitter on Hover and Active State Change

## Affected Scope
- `packages/app/src/components/titlebar-tab-nav.css`

## Observed Behavior
When switching between Desktop titlebar tabs or moving the pointer across overflowing tabs, adjacent tabs and the new-tab (`+`) button shifted horizontally by up to 24px.

## Expected Behavior
Showing or hiding a tab's close (`×`) button on hover or active state transitions must not change the tab's outer width or shift neighboring tabs and the `+` button.

## Reproduction Steps
1. Open two or more sessions in Desktop whose titles are long enough to trigger `data-title-overflow="true"`.
2. Switch between tabs or move the cursor onto and off an inactive overflowing tab.
3. Observe adjacent tabs and the `+` button shifting left and right.

## Root Cause
`[data-titlebar-tab-slot]` uses `w-auto min-w-36 max-w-56`, while `[data-slot="tab-link"]` reserves `pe-6` (`24px`) for the absolutely positioned close button. The rule `[data-titlebar-tab][data-title-overflow="true"]:not(:hover):not([data-active="true"]):not([data-editing="true"]) [data-slot="tab-link"] { padding-inline-end: 0; }` collapsed that 24px inline-end padding whenever an overflowing tab became inactive and unhovered, changing its intrinsic width and re-triggering overflow measurements.

## Fix
Removed the conditional `padding-inline-end: 0` override in `packages/app/src/components/titlebar-tab-nav.css` so `[data-slot="tab-link"]` keeps a fixed `pe-6` inline-end reserve regardless of hover or active state.

## Verification
- `cd packages/app && bun typecheck` — Passed with 0 errors.
- `cd packages/desktop && bunx electron-vite build` — Passed with the current renderer sources.
- Native Desktop check with an isolated profile and two existing long-title Sessions — Switched between both tabs and moved the pointer away from the tab strip. Adjacent tabs and the `+` button retained their horizontal positions across the observed hover and active states; the previous width jump was not reproduced.
- Clicked the active tab's close button — The tab closed and the remaining Session and transcript were displayed correctly.
