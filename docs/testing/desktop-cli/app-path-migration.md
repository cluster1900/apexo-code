# BUG-20261118-001. Apexo directory and renderer origin upgrade

## Scope

CLI, TUI, Desktop, local and remote HTTP clients, the plugin registry, and sessions in Apexo-managed Git worktrees.

## Observed behavior

- Apexo continued writing to the legacy `opencode` paths when those directories already existed. Desktop had the same behavior with the former `ai.opencode.desktop` profile and loaded its renderer from `oc://renderer`.
- During the first migration trial, Git and the session-by-ID endpoint could still open a migrated worktree. Directory-filtered V1 lists omitted its session for both request paths. The native list only returned it for the stored legacy path.
- Opening that worktree after migration also registered it twice under the same project.

## Expected behavior

Apexo uses the `apexo` directories and Desktop uses `apexo://renderer`. After an upgrade, sessions, settings, installed plugins, browser preferences, and Git worktree history remain available. When independent Apexo and OpenCode directories coexist, Apexo selects its own directory.

## Reproduction

1. Set the four XDG roots to new fixture directories, set `APEXO_APP_DIR_NAME=opencode`, and start `apexo serve`. Install a local plugin, create a Git worktree under the legacy data root, and save a session in the worktree. Verify that the V1 and native APIs list the session before migration.
2. Stop the server, remove the explicit profile name, and start the upgraded server. List sessions through `/session` and `/api/session` with the original and new directory paths. Open the worktree through both paths and list the project's sandboxes and directories.
3. For Desktop, seed a separate legacy profile with a saved window, a session route, and different values for one local storage key under both renderer origins. Start the packaged app and check the active renderer, restored route, retained preference, and authenticated sidecar requests.

## Cause and fix

- Startup previously selected the legacy directory until the canonical directory existed. Startup now moves the directory under a cross-process lock and leaves a backward alias. A staged link allows retries to complete an interrupted move. The plugin store translates absolute paths for packages and cached catalogs inside the migrated directory.
- V1 resolves a worktree to its real path before selecting sessions, while persistence stores absolute directory strings. V1 and native lists now match both paths for a verified app-managed worktree. Directory registration and native refresh update the existing row and retain its path. Snapshot lookup also recognizes repositories indexed by the legacy path and resolves old patch paths within the same worktree.
- Chromium scopes `localStorage` by origin. Desktop copies missing keys from the legacy origin before opening windows. The server accepts the exact old and new renderer origins for clients of both versions.

## Verification

- From `packages/apexo`, `bun test --timeout 30000 test/config/app-directory.test.ts test/plugin/store.test.ts test/project/project-directory.test.ts test/server/native-cors.test.ts test/server/project-copy.test.ts test/snapshot/snapshot.test.ts test/session/revert-compact.test.ts` passed 92 tests.
- In an isolated upgrade using the real CLI and a linked Git worktree, both APIs returned the saved session for both directory paths. A native refresh retained one registration with the Git worktree strategy. The installed plugin stayed enabled and reported a path under `apexo/plugins`. The compatibility TUI displayed the saved transcript, the native TUI opened the saved session, and both snapshot implementations restored an edited file from a pre-migration tree.
- On macOS arm64, `bun run build` and `bun run package --mac --dir` produced a runnable Desktop package. A separate test profile verified the migrated window and transcript, an old storage key, a conflicting newer value, authenticated requests to both APIs, and delivery of `apexo://new-session` to the renderer through IPC. Draft prefill belongs to the legacy layout and is outside that delivery check.
- `bun turbo typecheck --concurrency=2` passed all 21 tasks. `bun run check:generated` passed in `packages/client` and `packages/sdk/js`.
- `bun run test:httpapi` passed 360 scenarios in each of the coverage, authorization, and Effect modes.
- The App unit suite passed 114 tests and the Desktop runtime-profile suite passed three tests.
- `GITHUB_ACTIONS=false bun turbo test --concurrency=2` finished with seven local timeouts. Six cases passed when rerun separately. The remaining command sandbox network and Unix-socket test also timed out on the unmodified `main` baseline. Its timeout cause remains undetermined.
