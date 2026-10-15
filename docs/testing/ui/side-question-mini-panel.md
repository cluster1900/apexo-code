# BUG-20261014-083: Mini side-question panel used composer height

- Scope: the new `/btw` mini terminal panel; one observed real PTY failure.
- Observed: the panel showed its header and completed status, but the answer and controls were clipped. Fullscreen displayed the same answer correctly.
- Expected: the action panel receives the same dedicated height and input isolation as other mini panels.
- Reproduction: run `bun script/grok-side-question-tui.mjs` from `packages/apexo`.
- Root cause: the new route was added to rendering but omitted from footer height selection and composer key-binding exclusion.
- Fix: include `btw` in both existing action-panel route lists.
- Verification: real mini PTY rerun passes 8 checks including visible model answer, targeted cancellation, image input, and an untouched main transcript. Fullscreen also passes 8 checks.

## Hooks panel recurrence

The first Hooks mini PTY after resolving its package export showed only the panel header and key hints, then timed out waiting for the uncaptured state. The captured ANSI output proved the panel rendered inside the composer's short height. The new `hooks` route was missing from the same footer height selection and composer-binding exclusions. It is now included in those lists and the shared panel-close handling. The failed run is not acceptance evidence; the corrected mini and fullscreen fixtures each passed seven checks, including visible metadata, explicit reload, unchanged model request count, and passive reopening. This is one additional occurrence of the same integration mistake, not a new bug type.
