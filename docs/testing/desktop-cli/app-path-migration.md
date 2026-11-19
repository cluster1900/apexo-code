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

## BUG-20261119-006. Disabled native MCP server restarted in a migrated worktree

This affected native MCP preferences in Apexo-managed Git worktrees. Create a linked checkout under `opencode/worktree` with a default-enabled stdio server. Open the checkout, disconnect the server, stop the application, and migrate the data directory. Open the original and canonical checkout paths separately. The original path reported `disabled`. The canonical path reported `connected` and started another child process. Both should report `disabled` with a saved preference of `false` and a single recorded process start.

The preference file name and its ownership field were derived from the checkout path. The canonical path received a different identity and fell back to the configured default. The preference store now resolves verified managed worktree aliases to one canonical file and writer lock while retaining the workspace ID. Before the first explicit save, it reads historical records with their original ownership keys. A saved disable wins when historical records conflict. An explicit change or reset saves the reconciled choices and records that the historical files have been accounted for. A failed change restores the exact prior canonical bytes. A verified staged link also identifies the earlier path if startup stops before publishing the alias.

The linked-worktree test failed on the prior code with `connected` at the canonical path. On the fixed code, the real stdio fixture started once across both spellings and a reopen with only the staged link. Storage tests also verified concurrent writes across the aliases, workspace isolation, an invalid historical record, exact rollback, and a reset that stayed cleared. A separate filesystem check verified the saved disable and reset with a symlinked XDG parent and confirmed that a sibling checkout did not inherit the choice.

## BUG-20261119-007. A readable legacy configuration failed CLI startup under a read-only parent

This affected XDG startup for an existing legacy profile. Put a readable legacy configuration under the XDG config root, make the parent read-only, and run `apexo debug paths` as a regular user. The previous code failed with `EACCES` while creating `.apexo-migration-locks`. `apexo debug paths` should select the readable legacy path and `apexo debug config` should load its settings. A later startup should migrate the original settings once the parent becomes writable.

Directory migration treated permission errors as fatal, and global startup ignored the directory that migration selected. Permission and read-only filesystem errors now select whichever existing directory owns the readable configuration. Global startup uses the actual selection for each XDG root. A populated canonical directory keeps precedence. If the data move has already completed, startup can use the canonical directory and leave the staged link for a later writable startup to publish.

An unprivileged macOS CLI process reproduced the startup error on the prior code. With the fix, `debug paths` and `debug config` used the legacy settings under the read-only parent, then loaded the same settings from the canonical path after write access returned. The tests also exercised a blocked alias publication, an empty destination beside the legacy source, and an unreadable legacy source. A separate CLI run read the old configuration with both the configuration directory and its parent set to read-only. From `packages/apexo`, `bun test --timeout 30000 test/config/app-directory.test.ts test/v2/mcp-preferences-native.test.ts test/v2/mcp-oauth-native.test.ts test/project/project-directory.test.ts` passed all 33 tests.

Both generated-source checks passed, and `bun turbo typecheck --concurrency=2` passed all 21 tasks. `bun run test:httpapi` passed 360 scenarios in each of coverage, authorization, and Effect modes.

The first `GITHUB_ACTIONS=false bun turbo test --concurrency=2` run passed 17 of 18 Apexo batches. In batch 14, the missing-session `tui.selectSession` test expected HTTP 404 and received HTTP 401 (BUG-20261119-008). From `packages/apexo`, `bun test test/server/session-select.test.ts --timeout 30000` passed all three tests, and `GITHUB_ACTIONS=false APEXO_TEST_SHARD=14/18 bun run test` passed the original 29-file batch. The cause of the single aggregate failure remains undetermined.

## BUG-20261119-009. Native MCP OAuth required repeat authorization after worktree migration

Authorize a remote native MCP server from a managed worktree under the legacy root, migrate the data directory, and open the same checkout through the canonical root. A loopback OAuth server reproduced `available` through the old spelling and `missing` through the new spelling for the same server definition. Both spellings should reuse the same authorization and serialize refreshes when the provider rotates a token.

The credential identity included the exact worktree path. The native manager now reads historical identities for verified aliases of the checkout and keeps the same workspace ID, server name, URL, and OAuth configuration fingerprint. The canonical credential record and its lock take precedence for writes and refreshes. The store still validates the ownership, access mode, and contents of each historical file it reads.

The regression in `test/v2/mcp-oauth-flow.test.ts` failed with `missing` before the change. It now completes one real loopback authorization, uses the original credentials through both spellings, then issues parallel requests and observes one token refresh. A different workspace or OAuth client still has a separate identity.

## BUG-20261119-010. Compatibility schedules did not resume in migrated worktrees

Create a durable compatibility schedule in a Session under a managed legacy worktree. Stop the backend, migrate the data directory, and open the Session at the canonical worktree. The original scheduler storage ignored the old worktree hash. The live CLI also found an exact-path check in the compatibility Hook adapter and a persisted background-job row that reported `running` without a worker after a crash. The recovered schedule should keep its task ID and execute once at its next due time. Cancellation should persist across either path and later restarts.

The compatibility scheduler shares one store and writer lease across verified aliases. It checks the original record when a canonical per-Session file is absent. A canonical empty record retains cancellation. Recovery rereads the task under the lease, verifies the Session incarnation, and explicitly resumes a matching persisted background job with its cancellation callback. The compatibility Hook adapter uses the stored Session location for verified aliases and retains the explicit workspace check. Native schedules continue to use their Session-owned store.

The regression in `test/tool/scheduler-persistence.test.ts` recovered and ran an overdue task against a stale durable background row, rejected a competing alias owner, and confirmed cancellation from the other spelling. From `packages/apexo`, `bun script/grok-scheduler-restart.mjs cli --migrate-worktree` passed across three real backend processes. The same schedule fired once, woke its parent once, and remained absent after cancellation through the task API and a restart using the original path.

## BUG-20261119-011. A saved Session opt-out was lost when the App received the canonical path

Save a Session-level automatic-approval opt-out at the original path, then open the same checkout with directory-level automatic approval enabled at the canonical path. The previous permission evaluator returned `true` for that Session at the canonical path. The Session opt-out should take precedence while other Sessions can still inherit the directory setting.

The App migrates path-scoped opt-outs to the Session ID within the same saved server scope. A Session opt-out takes precedence over its directory setting. An explicit re-enable clears the old Session entries and records the grant for the chosen directory. Existing directory settings keep their own scope.

The App unit tests cover a migrated opt-out, descendant behavior, explicit re-enable, and persistence after reload. A production Web build and a rebuilt macOS Desktop window each used a real local backend and two Sessions in the same migrated worktree. The opted-out Session retained a real permission request until the user-facing approval action. The other Session accepted the same request automatically under the directory setting.

### Follow-up verification

- The focused Apexo run passed 58 tests across 11 files covering OAuth, scheduler persistence, durable background jobs, Hook ownership, and directory migration. An earlier parallel run reached a child CLI deadline in the read-only configuration test. The unchanged test passed in the final focused run.
- `bun run test:unit` in `packages/app` passed 116 tests. Both generated-source checks passed, and `bun turbo typecheck --concurrency=2` passed all 21 tasks.
- `GITHUB_ACTIONS=false bun turbo test --concurrency=2` passed all six Turbo tasks and all 18 Apexo batches. `bun run test:httpapi` passed all 360 scenarios in each of coverage, authorization, and Effect modes.
