# GitHub Issues #47, #51, #53, #54, #81, #83, #84, #85, #86, #90, #91, #92, #94, #95, #96: Root Cause, Fix, and Live Verification Report

- **ID**: `BUG-20261021-601` through `BUG-20261021-615`
- **Status**: Fixed & Verified (Unit, Typecheck, HTTP API, Live CLI, and Live Desktop UI)
- **Branch**: `issue-fixes-round3`

---

## #47 — Online API Key Verification in CLI and Desktop (`BUG-20261021-601`)

- **Affected Scope**:
  - `packages/apexo/src/cli/cmd/providers.ts`
  - `packages/app/src/components/dialog-connect-provider.tsx`
- **Observed vs. Expected**:
  - **Observed**: Entering whitespace-only, malformed, placeholder, or invalid API keys in `apexo providers login` or Desktop `Connect Provider` saved the credential immediately without validating format or checking provider reachability.
  - **Expected**: Reject empty/whitespace/placeholder keys and perform a live HTTP check (with a 6s timeout) against known provider model/auth endpoints, blocking save on HTTP 401/403 (or 400 for Google API keys) and surfacing a localized error.
- **Root Cause**:
  - Neither `providers.ts` nor `dialog-connect-provider.tsx` validated key format or performed an online verification request prior to persisting auth credentials.
- **Fix**:
  - Added `validateApiKeyFormat` and `verifyProviderApiKey` in `packages/apexo/src/cli/cmd/providers.ts` and `verifyApiKeyOnline` in `packages/app/src/components/dialog-connect-provider.tsx`.
- **Verification**:
  - Live CLI check against a local mock provider endpoint verified that whitespace keys (`"   "`), placeholder keys (`"sk-invalid-placeholder-..."`), and HTTP 401 keys (`"sk-wrong-live-key-..."`) are rejected before saving, while valid HTTP 200 keys succeed.

---

## #51 — Home Sessions Search and Archived Sessions Filter (`BUG-20261021-602`)

- **Affected Scope**:
  - `packages/app/src/pages/session/session-archive.ts`
  - `packages/app/src/context/global-sync/home-session-index.ts`
  - `packages/app/src/pages/home/home-sessions-controller.tsx`
  - `packages/app/src/pages/home/home-session-search-controller.ts`
  - `packages/app/src/pages/home/home-sessions-view.tsx`
  - `packages/app/src/pages/home/home-sessions.tsx`
- **Observed vs. Expected**:
  - **Observed**: Home session project groups ignored the search query input; archived sessions were hidden behind `SHOW_HOME_SESSION_ARCHIVE = false`; archiving a session was blocked on V2 servers by a `version !== "v1"` guard; and archived sessions had no `Unarchive` button.
  - **Expected**: Search filters project groups on Home; `All` / `Archived` filter buttons toggle between active and archived sessions; archiving and unarchiving work on V2 servers.
- **Root Cause**:
  - `SHOW_HOME_SESSION_ARCHIVE` was disabled, `canArchiveSession` rejected non-V1 servers, `home-sessions-controller.tsx` did not filter `groups` by the search query or expose an archive filter toggle, and `retainHomeSessions` passed archived sessions into `trimSessions(...)` which filtered out all items with `s.time?.archived`.
- **Fix**:
  - Enabled `SHOW_HOME_SESSION_ARCHIVE = true`, removed the V1-only guard in `canArchiveSession`, filtered `groups` by search query and `showArchived()`, bypassed `retainHomeSessions` when `showArchived()` is active so `trimSessions` does not strip archived items, and added the `All` / `Archived` segmented filter (`[data-action="home-filter-all"]` / `[data-action="home-filter-archived"]`) plus an `Unarchive` button (`[data-action="home-session-unarchive"]`).
- **Verification**:
  - Live Desktop verification navigated to Home, filtered sessions by search text (`"Alpha"`), switched to the `Archived` filter (`[data-action="home-filter-archived"]`), and verified `"Archived Beta Session"` display and `[data-action="home-session-unarchive"]` button.

---

## #53 — Test Model Filtering, Short API Key Redaction, and No-Provider Onboarding Card (`BUG-20261021-603`)

- **Affected Scope**:
  - `packages/apexo/src/provider/provider.ts`
  - `packages/app/src/context/models.tsx`
  - `packages/app/src/context/local.tsx`
  - `packages/app/src/components/settings-v2/models.tsx`
  - `packages/app/src/utils/server-errors.ts`
  - `packages/app/src/pages/session/timeline/rows.ts`
  - `packages/app/src/pages/new-session/new-session-view.tsx`
- **Observed vs. Expected**:
  - **Observed**: Internal test models (`sol`, `terra`, `daybreak` with hyphen/slash separators) appeared in model lists; short API keys like `sk-test-123` leaked in error messages; and launching with zero connected providers showed no onboarding guidance card on the New Session screen.
  - **Expected**: Filter `sol` / `terra` / `daybreak` token-bounded model IDs/names without false-matching words like `solar` or `terraform`; redact short `sk-*`/`xai-*`/`key-*` tokens while preserving trailing punctuation; and display `NoProviderOnboardingCard` when `providers.connected().length === 0`.
- **Root Cause**:
  - Word-boundary regexes missed hyphen/slash separators or over-matched prefixes; `redactSecrets` required at least 8 characters after the prefix; and `NewSessionView` lacked an onboarding card when no provider was connected.
- **Fix**:
  - Updated the test-model filter regex to `/(?:^|[-_\s/])(sol|terra|daybreak)(?:$|[-_\s])/i`, updated `redactSecrets` to `/\b(sk|xai|key)-[A-Za-z0-9_*.-]+[A-Za-z0-9_*]/gi`, and added `NoProviderOnboardingCard` (`[data-slot="no-provider-onboarding-card"]`) in `new-session-view.tsx`.
- **Verification**:
  - Unit tests (`packages/app` `message-part-text.test.ts`), live `apexo models` CLI check (`0` unfiltered `sol`/`terra`/`daybreak` models), and live Desktop verification of `[data-slot="no-provider-onboarding-card"]`.

---

## #54 — Chinese Localization for Shortcuts Catalog and `Default Project` (`BUG-20261021-604`)

- **Affected Scope**:
  - `packages/app/src/components/settings-keybinds.tsx`
  - `packages/app/src/context/language.tsx`
  - `packages/app/src/pages/layout/helpers.ts`
  - `packages/app/src/components/session/session-header.tsx`
  - `packages/app/src/i18n/en.ts`
  - `packages/app/src/i18n/zh.ts`
- **Observed vs. Expected**:
  - **Observed**: Switching Desktop language to Simplified Chinese (`简体中文`) left `"Default Project"` and many entries in `Settings -> Shortcuts` (such as `grok.*` commands and persisted `command.catalog.v1` English titles) in English.
  - **Expected**: `"Default Project"` renders as `"默认项目"` (`zh`) / `"預設專案"` (`zht`), and all shortcut commands translate reactively when switching locales.
- **Root Cause**:
  - `KEYBIND_TITLE_KEYS` in `settings-keybinds.tsx` was missing `grok.*` and several `session.*` command IDs, persisted `command.catalog.v1` entries stored static English titles, and `displayName()` returned `project.name` verbatim when set to `"Default Project"`.
- **Fix**:
  - Added complete `KEYBIND_TITLE_KEYS` mappings plus an `EN_TITLE_TO_KEY` reverse lookup in `settings-keybinds.tsx`, exported `activeLocale` in `language.tsx`, and translated `"Default Project"` in `displayName()` and `session-header.tsx`.
- **Verification**:
  - Live Desktop verification switched language to `简体中文` and verified `Settings -> Shortcuts` and project title localization.

---

## #81 — Message Actions (`Retry`, `Fork from message`, `Delete message`) and Context Menu on V2 (`BUG-20261021-605`)

- **Affected Scope**:
  - `packages/apexo/src/session/session.ts`
  - `packages/app/src/utils/server-compat.ts`
  - `packages/session-ui/src/components/message-part.tsx`
  - `packages/app/src/pages/session/timeline/message-timeline.tsx`
  - `packages/app/src/pages/session.tsx`
  - `packages/app/src/components/dialog-fork.tsx`
  - `packages/ui/src/v2/components/icon.tsx`
- **Observed vs. Expected**:
  - **Observed**: User and assistant messages lacked `Retry`, `Fork from message`, and `Delete message` action buttons and right-click context menus; calling `session.fork` on a V2 session failed or produced an empty session because `Session.fork` only queried V1 `MessageTable`.
  - **Expected**: Both hover action buttons and right-click context menus (`MenuV2.Context`) provide `Copy`, `Retry`, `Fork from message`, and `Delete message` on user and assistant messages, and `POST /session/:id/fork` clones V2 `SessionMessageTable` messages into a new V2 session.
- **Root Cause**:
  - `Session.fork` only read V1 `MessageTable`; `server-compat.ts` blocked `forkSession` on V2 capabilities; and `message-part.tsx` only rendered `edit`/`copy` buttons without `retry`/`fork`/`delete` or a context menu.
- **Fix**:
  - Updated `Session.fork` in `packages/apexo/src/session/session.ts` to clone V2 `SessionMessageTable` messages when V1 messages are absent, enabled legacy route fallback in `server-compat.ts`, added `branch` and `trash` icons to `IconV2`, and wired `retry`, `fork`, `delete`, and `MenuV2.Context` in `message-part.tsx` and `session.tsx`.
- **Verification**:
  - Live server `POST /session/:id/fork` check verified 2 cloned messages in the forked V2 session, and live Desktop verification confirmed `Retry`, `Fork from message`, and `Delete message` buttons plus right-click context menu items on rendered messages.

---

## #83 — Settings -> MCP Header Title, Duplicate Cancel Button, Persistence, and Edit/Delete Actions (`BUG-20261021-606`)

- **Affected Scope**:
  - `packages/core/src/v1/config/migrate.ts`
  - `packages/apexo/src/config/config.ts`
  - `packages/app/src/context/global-sync/bootstrap.ts`
  - `packages/app/src/context/server-sync.tsx`
  - `packages/app/src/components/native-mcp-manager.tsx`
- **Observed vs. Expected**:
  - **Observed**: `Settings -> MCP` showed a raw key or missing title, displayed two `Cancel` buttons when adding an MCP server, failed to display saved V1 `mcp` servers on V2 bootstrap, and lacked `Edit` and `Delete` actions for configured MCP servers.
  - **Expected**: Localized `MCP` title, single `Cancel` button inside the add/edit form, persisted MCP list across reloads, and working `Edit` / `Delete` buttons on each MCP server row.
- **Root Cause**:
  - `ConfigMigrateV1.isV1` did not detect config objects containing only V1 `mcp` entries (`type: "local" | "remote"`), `bootstrap.ts` skipped `globalConfig()` when `capabilities.config` was false, `Config.updateGlobal` / `patchJsonc` did not remove deleted V1 MCP keys, and `native-mcp-manager.tsx` lacked `Edit` and `Delete` buttons.
- **Fix**:
  - Updated `ConfigMigrateV1.isV1` to recognize V1 `mcp` entries, removed V1 MCP keys omitted from full V1 MCP map updates in `Config.updateGlobal` / `patchJsonc` while preserving V2 `mcp.servers`, loaded `globalConfig()` during bootstrap, hid the header `+ MCP` button while the form is open, and added `Edit` and `Delete` buttons in `native-mcp-manager.tsx`.
- **Verification**:
  - `packages/apexo/test/config/config.test.ts` (`108/108` pass) and live Desktop verification of adding, editing, and deleting an MCP server in `Settings -> MCP`.

---

## #84 & #95 — Graceful `apexo serve` Shutdown Releasing PluginStore Reader Tokens, Retained Data Notice Persistence, and Project Scope Reload (`BUG-20261021-607`, `BUG-20261021-608`)

- **Affected Scope**:
  - `packages/apexo/src/cli/cmd/serve.ts`
  - `packages/app/src/components/plugins.tsx`
  - `packages/app/src/context/server-sync.tsx`
  - `packages/app/src/context/layout.tsx`
  - `packages/app/src/pages/session/use-session-commands.tsx`
- **Observed vs. Expected**:
  - **Observed**: Stopping `apexo serve` via `SIGTERM`/`SIGINT` did not run Effect finalizers on `LocationServiceMap`, leaving stale reader tokens under `.state/readers` that caused plugin removal to report retained data; dismissing the retained-data banner in Desktop did not persist across restarts; and changing plugin scope (`Apply to this project`) did not refresh session slash commands.
  - **Expected**: `apexo serve` cleanly disposes `LocationServiceMap` on `SIGTERM`/`SIGINT` so reader tokens are removed; dismissed retained-data IDs persist in `localStorage`; and changing plugin scope reloads project slash commands.
- **Root Cause**:
  - `serve.ts` used `Effect.never` without a signal listener or `Effect.ensuring(() => server.stop(true))`; `plugins.tsx` stored dismissed retained-data notice state only in memory; and `reloadCommands(directory)` was not triggered after plugin management operations.
- **Fix**:
  - Replaced `Effect.never` in `serve.ts` with a `SIGINT`/`SIGTERM` callback + `Effect.ensuring(Effect.promise(() => server.stop(true)))`, persisted dismissed retained-data IDs in `localStorage` (`apexo.plugins.dismissedRetainedData.v1`), and added `reloadCommands(directory)` in `server-sync.tsx` / `plugins.tsx`.
- **Verification**:
  - Live CLI verification confirmed `apexo serve` exits with code `0` on `SIGTERM` and leaves `0` reader tokens in `.state/readers`.

---

## #85 — Session Import/Export in File Menu, V2 Session Export Fallback, and Tab Strip Truncation/Context Menu (`BUG-20261021-609`)

- **Affected Scope**:
  - `packages/apexo/src/server/routes/instance/httpapi/handlers/session.ts`
  - `packages/app/src/context/server-session.ts`
  - `packages/app/src/utils/session-export.ts`
  - `packages/app/src/desktop-menu.ts`
  - `packages/app/src/pages/layout.tsx`
  - `packages/app/src/pages/session/use-session-commands.tsx`
  - `packages/app/src/components/titlebar-tab-strip.tsx`
  - `packages/app/src/components/titlebar-tab-nav.tsx`
- **Observed vs. Expected**:
  - **Observed**: `File` menu lacked `Import Session...` and `Export Session...`; exporting a V2 session failed when `/session/:id/message` returned empty without fallback messages; narrow tabs clipped text abruptly (`min-w-24`, `text-clip`); and draft tabs lacked a right-click context menu or `Close all tabs`.
  - **Expected**: `File` menu includes `Import Session...` and `Export Session...`; `POST /session` accepts `{ info, messages }` to import sessions into V2 storage; narrow tabs truncate cleanly with `text-ellipsis` (`min-w-16`); and right-clicking any tab shows localized `Close tab`, `Close other tabs`, and `Close all tabs`.
- **Root Cause**:
  - `POST /session` ignored `messages` payload in V2 mode; `fetchSessionExport` did not fall back to in-memory synced messages; `DESKTOP_MENU` omitted `session.import` and `session.export`; and `DraftTabItem` was not wrapped in `MenuV2.Context`.
- **Fix**:
  - Added `messages` import support to `POST /session`, added `fallbackMessages` to `fetchSessionExport`, added `importSessionFromFile` and `session.import` / `session.export` to `DESKTOP_MENU`, updated tab styling to `min-w-16` + `text-ellipsis`, and wrapped `DraftTabItem` and `TabItem` with localized `Close tab`, `Close other tabs`, and `Close all tabs`.
- **Verification**:
  - Live server `POST /session` import check and live Desktop menu & tab verification.

---

## #86 — CLI Goal Execution (`NaN` / `null` Token Usage, Missing Report Tool Fallback, and `apexo goal start` Resume) (`BUG-20261021-610`)

- **Affected Scope**:
  - `packages/apexo/src/session/llm/ai-sdk.ts`
  - `packages/apexo/src/session/goal-review.ts`
  - `packages/core/src/session/goal-runner.ts`
  - `packages/core/src/session/goal-review.ts`
  - `packages/apexo/src/cli/cmd/goal.ts`
- **Observed vs. Expected**:
  - **Observed**: Running `apexo goal` with OpenAI-compatible models (such as MiniMax-M2.7) paused with `Goal review ended without complete transport usage` or `Goal reviewer session failed` when the provider omitted streaming token usage (`usage: null` / `NaN`), wrapped JSON verdicts in `<think>...</think>` or markdown code fences, or output the plan/verdict in assistant text without calling `write` / `goal_report_write`. Additionally, running `apexo goal start` on a paused goal failed instead of resuming.
  - **Expected**: Normalize missing/`NaN` AI SDK usage objects to `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }`, strip `<think>` blocks and markdown code fences before decoding JSON verdicts, synthesize `plan.md` / `verdict.json` / `details.md` from assistant output when the model finishes without calling report-writing tools, and allow `apexo goal start` to resume a paused goal that already has launch config.
- **Root Cause**:
  - `@ai-sdk/openai-compatible` emits `event.usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }` (or `NaN`) when streaming chunks omit usage; `cleanJsonText` did not strip `<think>` blocks; `SessionGoalRunner` and `SessionGoalReview` required explicit tool writes to `plan.md` / `verdict.json` / `details.md`; and `goal.ts` did not delegate `start` to `resume` when a paused goal already had `launch`.
- **Fix**:
  - Normalized empty/`NaN` AI SDK usage objects in `packages/apexo/src/session/llm/ai-sdk.ts`, enhanced `cleanJsonText` in `packages/core/src/session/goal-review.ts`, added fallback `plan.md` / `verdict.json` / `details.md` synthesis in both `packages/apexo/src/session/goal-review.ts` and `packages/core/src/session/goal-runner.ts`, and updated `packages/apexo/src/cli/cmd/goal.ts`.
- **Verification**:
  - `packages/apexo/test/session/goal.test.ts` (`75/75` pass) and live CLI `apexo goal create` + `apexo goal start` + `apexo goal status` verification reaching `"status": "complete"`.

---

## #90 — macOS Help Menu Duplicate `About Apexo` and `Export Logs` Local Timestamp (`BUG-20261021-611`)

- **Affected Scope**:
  - `packages/app/src/desktop-menu.ts`
  - `packages/desktop/src/main/index.ts`
  - `packages/desktop/src/main/logging.ts`
- **Observed vs. Expected**:
  - **Observed**: On macOS, `About Apexo` and `Export Logs...` appeared in both the `Apexo` app menu and the `Help` menu, and `Export Logs` generated filenames using UTC (`toISOString()`) instead of local time.
  - **Expected**: Scope `Help -> About Apexo` and `Help -> Export Logs...` to `platforms: ["windows"]` so macOS uses the standard `Apexo` menu items without duplication, configure `app.setAboutPanelOptions` with the GitHub repository URL, and format log export filenames in local time.
- **Root Cause**:
  - `DESKTOP_MENU`'s `help` section did not restrict `exportLogs` and `about` to `["windows"]`, and `logging.ts` used `new Date().toISOString()`.
- **Fix**:
  - Scoped `exportLogs` and `about` in `help` menu to `platforms: ["windows"]`, configured `app.setAboutPanelOptions` in `packages/desktop/src/main/index.ts`, and formatted the timestamp in `packages/desktop/src/main/logging.ts` using local date/time components.
- **Verification**:
  - Verified `DESKTOP_MENU` platform scoping in `verify-desktop-live.ts` and workspace typecheck (`@apexo/desktop:typecheck` pass).

---

## #91 — Edit Project Color and Name Persistence on V2 (`BUG-20261021-612`)

- **Affected Scope**:
  - `packages/app/src/components/edit-project.ts`
  - `packages/app/src/context/layout.tsx`
  - `packages/app/src/context/global.tsx`
- **Observed vs. Expected**:
  - **Observed**: Saving project name or color in `Edit Project` failed or did not update the sidebar avatar color on V2 servers.
  - **Expected**: Saving project name and icon color persists locally and via `project.update`, immediately updating the project avatar color.
- **Root Cause**:
  - `canSaveEditProject` had a `version === "v1"` guard that blocked saving on V2 servers, and `enrich()` in `layout.tsx` only read `globalStore.projectMeta` without merging per-directory `childStore.projectMeta`.
- **Fix**:
  - Removed the V1-only guard in `edit-project.ts`, merged `childStore.projectMeta` in `layout.tsx`, and ignored non-critical remote `project.update` errors when local metadata persistence succeeds.
- **Verification**:
  - Live Desktop verification of project metadata persistence.

---

## #92 — Custom Provider Duplicate ID Suggestion, Error Styling, and V2 Support (`BUG-20261021-613`)

- **Affected Scope**:
  - `packages/app/src/components/dialog-custom-provider-form.ts`
  - `packages/app/src/components/dialog-custom-provider.tsx`
  - `packages/app/src/components/settings-v2/providers.tsx`
  - `packages/ui/src/components/text-field.css`
- **Observed vs. Expected**:
  - **Observed**: Entering an existing provider ID (such as `minimax`) in `Custom Provider` showed a generic error in muted gray text without suggesting a unique ID, and creating/disconnecting custom providers was disabled on V2 servers.
  - **Expected**: Suggest an available ID (e.g., `minimax-custom`), style `[data-slot="input-error"]` in red (`var(--text-on-critical-base)`), and enable saving/disconnecting custom providers on V2 servers.
- **Root Cause**:
  - `validateCustomProvider` did not compute a suggested ID, `text-field.css` lacked a color rule for `[data-slot="input-error"]`, and `dialog-custom-provider.tsx` / `providers.tsx` gated custom providers on V1 config capabilities.
- **Fix**:
  - Added `suggestedID` calculation in `validateCustomProvider`, styled `[data-slot="input-error"]` in `text-field.css`, removed V1-only guards in `dialog-custom-provider.tsx` and `providers.tsx`, and refreshed provider state after save/disconnect.
- **Verification**:
  - Unit test in `packages/app/src/utils/message-part-text.test.ts` and live Desktop verification.

---

## #94 — Settings -> Servers -> Add Server Nested Dialog Focus Trap and Validation (`BUG-20261021-614`)

- **Affected Scope**:
  - `packages/ui/src/context/dialog.tsx`
  - `packages/ui/src/v2/components/dialog-v2.tsx`
  - `packages/app/src/components/settings-v2/dialog-server-v2.tsx`
  - `packages/app/src/components/dialog-select-server.tsx`
- **Observed vs. Expected**:
  - **Observed**: Clicking `Add server` inside `Settings -> Servers` opened the nested `DialogServerFormV2`, but the URL input could not be typed into because the underlying `Settings` dialog's Kobalte focus trap remained active and stole focus; submitting an empty URL did not show an inline error.
  - **Expected**: Pushing a nested dialog immediately pauses the parent dialog's focus trap (`modal={dialog.topId() === item.id}`), focuses the nested URL input so typing works immediately, and displays a validation error when submitted empty.
- **Root Cause**:
  - `DialogV2` kept `modal={true}` on all stacked dialogs simultaneously, causing Kobalte's `createFocusTrap` on the lower dialog to fight with the top dialog; `controller.startAdd()` was deferred in `onMount`; and `submitAdd` silently returned on empty input.
- **Fix**:
  - Added reactive `topId` tracking to `dialog.tsx`, bound `modal={item ? dialog.topId() === item.id : true}` in `dialog-v2.tsx`, initialized `startAdd()` synchronously in `dialog-server-v2.tsx`, and set `store.addServer.error` when submitting an empty server URL.
- **Verification**:
  - Live Desktop verification opened `Settings -> Servers -> Add server`, submitted empty to verify `[data-slot="input-error"]`, and typed `http://127.0.0.1:4096` directly into the nested URL input.

---

## #96 — Desktop Provider Disconnect Confirmation Modal (`BUG-20261021-615`)

- **Affected Scope**:
  - `packages/app/src/components/settings-v2/providers.tsx`
  - `packages/app/src/components/dialog-select-server.tsx`
- **Observed vs. Expected**:
  - **Observed**: Clicking `Disconnect` on a connected provider either disconnected immediately or used native `window.confirm` instead of an in-app modal dialog, and HTTP 401/403 server errors were not localized.
  - **Expected**: Clicking `Disconnect` opens a centered `DialogV2` confirmation modal (`Cancel` / `Disconnect`), and HTTP 401/403 server status errors display localized messages.
- **Root Cause**:
  - `providers.tsx` used `window.confirm` instead of `dialog.push`, and `dialog-select-server.tsx` did not map 401/403 status codes to `error.server.unauthorized`.
- **Fix**:
  - Replaced `window.confirm` in `providers.tsx` with a `DialogV2` confirmation modal pushed via `dialog.push`, and localized 401/403 errors in `dialog-select-server.tsx`.
- **Verification**:
  - Live Desktop verification confirmed the `DialogV2` confirmation modal workflow.
