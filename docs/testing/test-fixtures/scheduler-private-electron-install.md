# BUG-20261015-254: Private Electron dependency lacked its optional installed binary

- Status: Setup corrected; actual private Desktop window launches successfully.
- Scope: Isolated Scheduler UI workspace, one fixture setup episode.
- Observed: the rebuilt Desktop native-window harness failed before launching Electron because the private dependency lacked `electron/path.txt`.
- Expected: validation has the exact pinned Electron package's installed binary as well as its JavaScript package files.
- Root cause: the private frozen-lock dependency install retained Electron 42.3.3 source files but did not execute its optional install script. A successful App/Desktop bundle build alone does not verify runtime binary availability.
- Fix: run that exact private package's `install.js`, which supplies its matching binary and path file. Do not mutate shared dependencies, replace dependency identities or change the lockfile.
- Verification: from private `packages/desktop`, `bun ./node_modules/electron/install.js` exited 0. The actual rebuilt Electron window subsequently loaded the Scheduler UI and passed seven en/zh/zht management and narrow-layout checks with seven provider calls, then two permission checks with five setup calls. The separate final provider-count fixture issue is recorded in BUG238; binary setup is not blamed for it. Owned server/process inspection showed no residual child after the failed startup.
