# BUG-20261014-018: Report Preview Remained Below Viewport After Clicking View

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: App / Desktop Goal report viewer with long report lists in the native 1280x800 window.
- **Observed**: After clicking "View objective.txt", the preview content loaded below the report list, but neither the preview title nor body scrolled into the visible viewport.
- **Expected**: Explicitly clicking to view a report scrolls the newly rendered preview into the visible viewport, whereas downloading a report preserves the current scroll position.
- **Reproduction**: Run `bun script/grok-goal-native.mjs` in `packages/apexo` with viewport and `elementFromPoint` assertions enabled.
- **Root Cause**: The preview rendered after all report list items without scrolling into view once rendered.
- **Fix**: After loading a viewed report, scroll the preview into the nearest visible position on the next animation frame; cancel pending frame callbacks and abort in-flight requests on unmount. Do not implicitly open or replace the preview when downloading.
- **Verification**: App and Desktop builds, App typecheck, `grok-goal-ui.mjs cli|desktop` (12/12 each), and native window checks (7/7) all passed with viewport and hit-target assertions.
