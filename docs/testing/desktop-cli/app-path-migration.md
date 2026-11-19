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

## Follow-up path audit

A profile had a populated legacy state directory beside an empty `apexo` directory. The initial migration skipped the move because it checked only for the destination's existence. Reproduce this by creating the empty destination in the XDG state fixture before starting the two child processes in `app-directory.test.ts`. The regression reproduced a legacy directory left in place. The migration now adopts a real legacy directory when the destination is empty and keeps the precedence of a populated destination.

Local Qwen can persist an absolute model path rooted in the legacy cache. The state reader now resolves the saved path through the verified cache alias for managed models. The regression fixture preserves an external model path and confirms that downloaded weights remain visible. The plugin registry uses the same path resolver for its managed package and catalog locations.

The Web and Desktop theme preload now use `apexo-theme-preload.js`. The embedded Web response computes its CSP hash from the renamed inline script. The shipped theme file also uses its Apexo name and retains the saved theme ID.

On an upgraded local profile, a runtime path probe selected the four `apexo` directories, the canonical global config, and all three installed plugins. The model file retained its filesystem identity. The directory, plugin, Local Qwen, embedded UI, and CORS regression run passed 32 tests.

- Clean startup selected the `apexo` directories and database filename. The real CLI upgrade and both TUI transports preserved the legacy worktree session. Both snapshot implementations restored files from before the migration.
- The Web and macOS arm64 Desktop production builds shipped the new preload resource. The Web HTML contained the renamed inline script and its CSP hash matched. The packaged Desktop loaded the new URL, returned 404 for the old resource path, and restored the saved window and transcript. The isolated retry used the Chromium test keychain after the first launch stalled in macOS keychain initialization.
- Both SDK generation checks and all 21 typecheck tasks passed. The App unit suite passed 114 tests. `bun run test:httpapi` passed 360 scenarios in each of the three modes.
- The local full unit run had two timeouts in the ACP initialization and structured review CLI tests. Both cases passed individually. Replaying their complete batches using `APEXO_TEST_SHARD=1/18` and `APEXO_TEST_SHARD=6/18` with `bun run script/run-tests.ts` also passed.
