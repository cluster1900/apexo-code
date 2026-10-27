# BUG-20261026-001: App browser and E2E scripts target missing test paths

- **Status:** Investigating; no source fix has been applied.
- **Affected scope:** `packages/app` test scripts and browser/E2E test entrypoints.
- **Observed behavior:** `bun run test:browser` exits with status 1 before running a test because Bun reports `Test filter "./test-browser" had no matches`; `bun run test:e2e -- --list` exits with status 1 because Playwright reports `No tests found` for the configured `./e2e` directory.
- **Expected behavior:** The documented browser and E2E commands should resolve existing test directories/files and run their suites, or the package should omit stale scripts until those suites exist.
- **Reproduction:**
  1. From the repository root, run `bun run test:browser --cwd packages/app` (or `cd packages/app && bun run test:browser`).
  2. Observe Bun 1.3.14 report `Test filter "./test-browser" had no matches` and exit 1.
  3. Confirm that `packages/app/test-browser` is absent while the package manifest still defines `test:browser` as `bun test --conditions=browser --preload ./happydom.ts ./test-browser`.
  4. From `packages/app`, run `bun run test:e2e -- --list` and observe `No tests found`; `playwright.config.ts` still sets `testDir: "./e2e"` and the directory contains only a generated report.
- **Root cause:** The package scripts reference removed or never-created browser/E2E test paths. The intended replacement entrypoints are not identified in the current tree.
- **Fix:** Investigating. Decide whether to restore the browser/E2E test suites or update/remove the stale scripts after confirming the intended coverage.
- **Verification:** `bun run test:browser` from `packages/app`: **FAIL (reproduced)**; `bun run test:e2e -- --list`: **FAIL (reproduced)**. `bun run test:unit` from the same package: **PASS**, 107 tests / 1008 assertions; this does not validate the missing browser/E2E entrypoints.
- **Linked constraints:** None; this is the first observed occurrence of this exact root cause.
