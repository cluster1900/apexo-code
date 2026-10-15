# Profile Acceptance CLI Stdin

## BUG-20261014-042 — Open stdin pipe blocks a noninteractive CLI fixture

- **Status:** Fixed and verified.
- **Verified recurrence count:** 1.
- **Affected scope:** `packages/apexo/script/grok-profile-desktop.mjs` CLI comparison step.
- **Observed behavior:** Native profile selection, pending-tool verification, and relaunch verification completed. The subsequent CLI subprocess emitted no output and exceeded its 60-second deadline.
- **Expected behavior:** The CLI runs the supplied prompt and emits its actual available-tools manifest for comparison with the native backend.
- **Reproduction:** Start `apexo run --profile grok-build --format streaming-json` using `execFile` without closing the child stdin pipe.
- **Root cause:** Noninteractive `run.ts` explicitly awaits `Bun.stdin.text()` before submitting its prompt. `execFile` creates a writable stdin pipe that remains open; the fixture supplied neither input nor EOF. Backend logs confirmed the child initialized, while the provider fixture received no request for this prompt.
- **Fix:** Close the owned CLI child's stdin immediately after spawning it. Preserve the original 60-second deadline and compare both its advertised manifest and actual provider request with native Desktop.
- **Verification:** Full native profile acceptance passed on Bun 1.3.14 after the EOF fix. The real CLI completed within the unchanged 60-second deadline and its manifest exactly matched its provider request.
