# BUG-20261014-019: Native Click Helper Hung Waiting on requestAnimationFrame

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: Native click helper in `grok-goal-native.mjs`.
- **Observed**: Before clicking the Goal button, an `eval` awaiting two nested `requestAnimationFrame` callbacks timed out after 45 seconds (`SIGTERM`) even though the DOM button was already present and interactive.
- **Expected**: Verify bounded visibility, stable geometry, and hit-target readiness without hanging indefinitely when animation frames are throttled.
- **Root Cause**: Used an unbounded `requestAnimationFrame` Promise as the click readiness gate while concurrent browser windows were running and potentially throttling frame callbacks.
- **Fix**: Poll bounding-box geometry and `elementFromPoint` with a bounded timeout, proceeding once two consecutive samples have identical coordinates inside the viewport and hit the target element. Run native visual verification sequentially.
- **Verification**: All 7 native window scenarios passed with position-stability and hit-target assertions.
