# BUG-20261026-001: App browser and E2E scripts target missing test paths

- **Status:** Fixed; browser and E2E entrypoints now discover runnable tests.
- **Affected scope:** `packages/app` test scripts and browser/E2E test entrypoints.
- **Observed behavior before the fix:** `bun run test:browser` exited with status 1 before running a test because Bun reported `Test filter "./test-browser" had no matches`; `bun run test:e2e -- --list` exited with status 1 because Playwright reported `No tests found` for the configured `./e2e` directory.
- **Expected behavior:** The documented browser and E2E commands resolve existing test directories/files and run their suites.
- **Reproduction:**
  1. From the repository root, run `bun run test:browser --cwd packages/app` (or `cd packages/app && bun run test:browser`).
  2. Observe Bun 1.3.14 report `Test filter "./test-browser" had no matches` and exit 1.
  3. Confirm that `packages/app/test-browser` is absent while the package manifest still defines `test:browser` as `bun test --conditions=browser --preload ./happydom.ts ./test-browser`.
  4. From `packages/app`, run `bun run test:e2e -- --list` and observe `No tests found`; `playwright.config.ts` still sets `testDir: "./e2e"` and the directory contains only a generated report.
- **Root cause:** The browser script referenced a removed `test-browser` path, and the Playwright test directory contained only a generated report with no test source. The E2E typecheck script also referenced a missing `e2e/tsconfig.json`.
- **Fix:** Point `test:browser` at the existing `src` test suite under browser conditions; add `e2e/tsconfig.json`; add a backend-independent Playwright root-shell smoke test at `e2e/smoke.test.ts` so the configured E2E directory has a real entrypoint.
- **Verification:** `bun run test:browser`: **PASS**, 107 tests / 1008 assertions. `bun run typecheck:e2e`: **PASS**. `bun run test:e2e -- --list`: **PASS**, 1 test discovered. `bun run test:e2e`: **PASS**, 1 test. `bun run test:e2e:local`: **PASS**, 1 test. `bun run test:unit`: **PASS**, 107 tests / 1008 assertions. `bun run typecheck` and `bun run build`: **PASS**.
- **Linked constraints:** None; this is the first observed occurrence of this exact root cause.
