# Apexo feature and flow inventory

This inventory is generated from the checked-out source tree and is the test index for the audit. It covers user-facing surfaces, public HTTP operations, IPC contracts, terminal commands, and the shared runtime domains. It intentionally names source files so every item can be traced to code.

## Test status legend

- **PASS**: the listed verification completed successfully in this checkout.
- **FAIL**: a reproducible defect was observed; see the linked bug record and GitHub issue.
- **PENDING**: not yet executed in this audit.
- **LIMITED**: the source contract is covered, but an external provider, OS, or interactive credential is required for full behavior.

## Architecture and lifecycle flows

1. **CLI/TUI/Desktop bootstrap** loads configuration, selects a Location/project, starts or connects to the Apexo server, and attaches the relevant UI transport.
2. **Server request flow** authenticates and authorizes the request, resolves Location/session ownership, validates Protocol schemas, calls Core services, persists state, and publishes events.
3. **Session flow** creates or resumes a durable session, admits prompt input, schedules execution, streams model/tool events, handles permission/question requests, and projects messages/history to clients.
4. **Tool flow** resolves agent/model/tool registries, applies permissions and sandbox policy, runs shell/process/MCP/LSP operations, and records output, cancellation, and errors.
5. **UI flow** subscribes to session/event streams, renders messages and tool state, accepts prompt/command input, opens dialogs, and reconciles durable state after reload.
6. **Persistence flow** uses Core database schemas and migrations for projects, sessions, messages, goals, tasks, workflows, permissions, feedback, Memory, plugins, and schedules.

Runtime dependency direction required by AGENTS.md: Schema → Core/Protocol → Server; Client may depend on Schema/Protocol; sdk-next composes Client/Core/Server.

## Server and Protocol HTTP API inventory

Protocol groups: **33**; operations declared in the group files: **150**. The legacy server also exposes compatibility routes; `packages/apexo/test/server/httpapi-exercise` covers the combined public route surface (346 scenarios in the current run).

### `agent`

`agent.list`

### `command`

`command.list`

### `credential`

`credential.update`, `credential.remove`

### `event`

`event.subscribe`

### `feedback`

`feedback.list`, `feedback.save`, `feedback.review`, `feedback.image`, `feedback.remove`

### `fs`

`fs.read`, `fs.list`, `fs.find`

### `goal`

`goal.get`, `goal.create`, `goal.start`, `goal.run`, `goal.resume`, `goal.pause`, `goal.clear`, `goal.reports`, `goal.report`, `goal.cleanupReports`

### `health`

`health.get`

### `hooks`

`hooks.get`, `hooks.reload`, `hooks.trust`, `hooks.preference`

### `integration`

`integration.connect.external`, `integration.list`, `integration.get`, `integration.connect.key`, `integration.connect.oauth`, `integration.attempt.status`, `integration.attempt.complete`, `integration.attempt.cancel`

### `location`

`location.get`

### `lsp`

`lsp.status`

### `mcp`

`mcp.status`, `mcp.connect`, `mcp.disconnect`, `mcp.retry`, `mcp.resetPreference`, `mcp.authStart`, `mcp.authCancel`

### `memory-operation`

`memory.retry`, `memory.recoveryPreview`, `memory.recover`, `memory.migrationPreview`, `memory.migrate`, `memory.dream`, `memory.flush`, `memory.operations`, `memory.operation`, `memory.cancel`

### `memory`

`memory.status`, `memory.toggle`, `memory.list`, `memory.preview`, `memory.forget`

### `message`

`session.messages`

### `model`

`model.list`

### `permission`

`permission.request.list`, `permission.saved.list`, `permission.saved.remove`, `session.permission.create`, `session.permission.list`, `session.permission.get`, `session.permission.reply`

### `plugins`

`plugins.list`, `plugins.detail`, `plugins.manage`, `plugins.runtime`, `plugins.reload`

### `process`

`process.list`, `process.output`, `process.wait`, `process.cancel`

### `project-copy`

`projectCopy.create`, `projectCopy.remove`, `projectCopy.refresh`

### `project`

`project.list`, `project.current`

### `provider`

`provider.list`, `provider.get`

### `pty`

`pty.list`, `pty.create`, `pty.get`, `pty.update`, `pty.remove`, `pty.connectToken`, `pty.connect`

### `question`

`question.request.list`, `session.question.list`, `session.question.reply`, `session.question.reject`

### `reference`

`reference.list`

### `schedule`

`schedule.list`, `schedule.get`, `schedule.delete`, `schedule.pause`, `schedule.resume`

### `session-mcp-attachment`

`sessionMcpAttachment.reserve`, `sessionMcpAttachment.execute`, `sessionMcpAttachment.status`, `sessionMcpAttachment.cancel`

### `session`

`session.list`, `session.create`, `session.sandbox`, `session.active`, `session.get`, `session.remove`, `session.switchAgent`, `session.switchModel`, `session.prompt`, `session.input.execution`, `session.input.wait`, `session.input.interrupt`, `session.compact`, `session.restore`, `session.wait`, `session.revert.stage`, `session.revert.clear`, `session.revert.commit`, `session.context`, `session.history`, `session.events`, `session.interrupt`, `session.message`

### `side-question`

`sideQuestion.list`, `sideQuestion.ask`, `sideQuestion.cancel`

### `skill`

`skill.list`, `skill.reload`

### `task`

`task.message.send`, `task.message.get`, `task.list`, `task.output`, `task.wait`, `task.cancel`

### `workflow`

`workflow.related`, `workflow.launch`, `workflow.sources`, `workflow.validate`, `workflow.list`, `workflow.start`, `workflow.get`, `workflow.resume`, `workflow.pause`, `workflow.stop`

### Server handler responsibilities

Each group above has a corresponding handler in `packages/server/src/handlers/` and is wired from `packages/server/src/routes.ts`: authentication/CORS/middleware, projects and Locations, sessions/messages/events, providers/integrations/credentials, permissions/questions, filesystem/search, PTY/process/task, goals/workflows/schedules, Memory, MCP/LSP, plugins/skills/hooks, feedback, and health.

## CLI inventory (`packages/cli`, `packages/apexo/src/cli`)

| Command | Flow |
|---|---|
| `apexo api` | Call an OpenAPI operation or method/path; supports request body, headers, and path/query parameters. |
| `apexo debug agents` | List registered agents for troubleshooting. |
| `apexo migrate` | Migrate v1 data to v2. |
| `apexo service start` / `restart` / `status` / `stop` | Manage the background server daemon. |
| `apexo service password [value]` | Read or set the daemon password. |
| `apexo serve` | Start the v2 API server with hostname, optional port, and registration flag. |

Apexo runtime CLI flows include bootstrap, daemon/network discovery, local or remote host selection, headless output, interactive/minimal/fullscreen TUI launch, prompt delivery, session resume, signal/exit handling, and TUI worker lifecycle. Source: `packages/cli/src/commands/commands.ts` and `packages/apexo/src/cli/`.

## TUI inventory (`packages/tui`)

### User flows

- Bootstrap and connect to a local/remote server; choose project, session, agent, model, provider, theme, context window, and terminal mode.
- Prompt editing with multiline, Vim mode, compact mode, history, stash, clipboard, attachments, slash command completion, queued/steering input, and interrupt/abort.
- Session timeline rendering for user/assistant/tool/thinking messages, diffs, file/media attachments, process/task output, permissions, questions, side questions, feedback, and errors.
- Dialog routes for agents, commands, dashboard, debug, feedback, goals/reports, hooks, MCP, Memory, model/provider, plugins, sessions, side questions, skills, status, tags, tasks, themes, variants, workflows, workspace/project selection and file changes.
- Local/fullscreen/minimal terminal modes, scrollback, keymap/help, external editor, terminal setup/doctor, export/copy, plan review, session move/fork/delete/rename, and logout.

### Slash commands

`/usage`, `/context`, `/delete`, `/copy`, `/history`, `/plan`, `/view-plan`, `/effort`, `/docs`, `/release-notes`, `/tutorial`, `/doctor`, `/settings`, `/multiline`, `/minimal`, `/fullscreen`, `/import-claude`, `/auto`, `/vim-mode`, `/compact-mode`, `/context-window`, `/logout`, `/resume`, `/session-info`, `/dashboard`, `/edit-prompt`, `/move`

Aliases and argument-bearing commands are defined in `packages/tui/src/component/grok-commands.tsx` and mirrored (with Desktop-specific additions) in `packages/app/src/components/grok-commands.tsx`.

### TUI component surface

`command-palette`, `command-sandbox-browser`, `dialog-agent`, `dialog-command-sandbox`, `dialog-dashboard`, `dialog-debug`, `dialog-feedback`, `dialog-goal`, `dialog-hooks`, `dialog-mcp`, `dialog-memory`, `dialog-memory-review`, `dialog-memory-work`, `dialog-model`, `dialog-move-session`, `dialog-plugins`, `dialog-provider`, `dialog-session-delete-failed`, `dialog-session-list`, `dialog-session-rename`, `dialog-side-question`, `dialog-skill`, `dialog-stash`, `dialog-status`, `dialog-tag`, `dialog-tasks`, `dialog-theme-list`, `dialog-variant`, `dialog-workflow`, `dialog-workspace-create`, `dialog-workspace-file-changes`, `dialog-workspace-list`, `dialog-workspace-unavailable`, `error-component`, `feedback-browser`, `goal-reports`, `grok-commands`, `hooks-browser`, `logo`, `mcp-browser`, `mcp-resource-picker`, `memory-browser`, `memory-capture-notifications`, `memory-health`, `memory-operations`, `memory-review`, `memory-work`, `plugin-route-missing`, `plugins-browser`, `session-goal`, `side-question-browser`, `spinner`, `startup-loading`, `task-message`, `todo-item`, `use-connected`, `workflow-browser`, `workspace-label`

## Desktop/Web application inventory (`packages/app`)

### Pages and navigation

`pages/directory-layout.tsx`, `pages/error.tsx`, `pages/home.tsx`, `pages/home/home-projects-controller.tsx`, `pages/home/home-projects-view.tsx`, `pages/home/home-projects.tsx`, `pages/home/home-sessions-controller.tsx`, `pages/home/home-sessions-view.tsx`, `pages/home/home-sessions.tsx`, `pages/home/legacy-home.tsx`, `pages/layout-new.tsx`, `pages/layout.tsx`, `pages/layout/inline-editor.tsx`, `pages/layout/session-tab-avatar.tsx`, `pages/layout/sidebar-items.tsx`, `pages/layout/sidebar-project.tsx`, `pages/layout/sidebar-shell.tsx`, `pages/layout/sidebar-workspace.tsx`, `pages/new-session.tsx`, `pages/new-session/new-session-view.tsx`, `pages/new-session/use-new-session-commands.tsx`, `pages/session.tsx`, `pages/session/composer/session-composer-region.tsx`, `pages/session/composer/session-followup-dock.tsx`, `pages/session/composer/session-permission-dock.tsx`, `pages/session/composer/session-question-dock.tsx`, `pages/session/composer/session-revert-dock.stories.tsx`, `pages/session/composer/session-revert-dock.tsx`, `pages/session/composer/session-todo-dock.tsx`, `pages/session/composer/todo-panel-motion.stories.tsx`, `pages/session/file-tabs.tsx`, `pages/session/review-tab.tsx`, `pages/session/session-side-panel.tsx`, `pages/session/terminal-panel-v2.tsx`, `pages/session/terminal-panel.tsx`, `pages/session/timeline/message-timeline.tsx`, `pages/session/use-composer-commands.tsx`, `pages/session/use-session-commands.tsx`, `pages/session/v2/review-panel-v2.tsx`, `pages/session/v2/session-file-browser-tab.tsx`, `pages/session/v2/session-file-list-v2.tsx`

Home/project/session/new-session layouts support project selection, directory/workspace switching, session archive/search/resume, tabs, deep links, file/review panels, timeline, terminal, composer, and session side panels.

### Application dialogs/components

`agent-dashboard`, `background-tasks`, `command-sandbox-dialog`, `debug-bar`, `dialog-command-palette-v2`, `dialog-connect-provider`, `dialog-connect-provider.stories`, `dialog-custom-provider`, `dialog-edit-project`, `dialog-edit-project-v2`, `dialog-fork`, `dialog-help-v2`, `dialog-manage-models`, `dialog-resume-session`, `dialog-select-directory`, `dialog-select-directory-v2`, `dialog-select-file`, `dialog-select-mcp`, `dialog-select-model`, `dialog-select-model-unpaid`, `dialog-select-model-unpaid-v2`, `dialog-select-model-unpaid-v2.stories`, `dialog-select-server`, `dialog-session-info`, `dialog-session-usage`, `dialog-settings`, `dialog-timeline`, `directory-picker`, `external-link`, `feedback-dialog`, `file-tree`, `file-tree-v2`, `goal-reports`, `grok-commands`, `help-button`, `hooks-dialog`, `mcp-attachment-picker`, `memory-browser`, `memory-capture-notifications`, `memory-health`, `memory-operations`, `memory-review`, `memory-work`, `model-tooltip`, `native-mcp-authentication`, `native-mcp-manager`, `plugins`, `plugins-dialog`, `prompt-input`, `prompt-input-v2`, `prompt-input.stories`, `prompt-project-selector`, `prompt-workspace-selector`, `session-command-sandbox`, `session-context-usage`, `session-feedback`, `session-goal`, `session-hooks`, `session-mcp-attachments`, `session-side-question`, `session-workflow`, `settings-dialog`, `settings-general`, `settings-keybinds`, `settings-list`, `settings-models`, `settings-providers`, `settings-runtime-profile`, `settings-server-picker`, `settings-servers`, `side-question-dialog`, `status-popover`, `status-popover-body`, `task-message`, `terminal`, `titlebar`, `titlebar-tab-nav`, `titlebar-tab-popover`, `titlebar-tab-strip`, `windows-app-menu`, `workflow-dialog`

These cover provider/model/server setup, settings/keybinds, project and directory editing, session info/usage/timeline/review, prompt and command palette, file selection/tree, MCP/plugin/hook/Memory/goal/task/workflow/feedback/question/permission surfaces, terminal, notifications, and onboarding.

## Desktop shell inventory (`packages/desktop`)

### Main/preload lifecycle

- Electron main process: app initialization, logging, crash/unresponsive handling, sidecar/server startup, window registry/state, deep links, onboarding, installation state, menus, external URLs, runtime profiles, and native translations.
- Renderer: App providers, MemoryRouter with persisted last-active URL, platform adapters, WSL server readiness on Windows, zoom/fullscreen/titlebar integration, onboarding, and Sentry error reporting.
- Native file/attachment flows: directory/file/save pickers, picked-file token lifetime, clipboard image read, open/reveal paths, external/local URLs.
- Storage flows: named store get/set/delete/clear/keys/length plus draft text/blob persistence.
- Windows/WSL flows: create/close/minimize/maximize/fullscreen/reload/devtools/zoom, focus/show/relaunch, WSL probe/refresh/install distro/install Apexo/open terminal/add/remove/start server and event subscription.

### Preload IPC channels

`kill-sidecar`, `install-cli`, `await-initialization`, `wsl-servers-get-state`, `wsl-servers-subscribe`, `wsl-servers-unsubscribe`, `wsl-servers-probe-runtime`, `wsl-servers-refresh-distros`, `wsl-servers-install-wsl`, `wsl-servers-install-distro`, `wsl-servers-probe-addable`, `wsl-servers-install-apexo`, `wsl-servers-open-terminal`, `wsl-servers-add`, `wsl-servers-remove`, `wsl-servers-start`, `consume-initial-deep-links`, `get-runtime-profile`, `set-runtime-profile`, `get-default-server-url`, `set-default-server-url`, `is-first-launch-onboarding-pending`, `finish-first-launch-onboarding`, `is-old-layout-eligible`, `get-display-backend`, `set-display-backend`, `check-app-exists`, `resolve-app-path`, `store-get`, `store-set`, `store-delete`, `store-clear`, `store-keys`, `store-length`, `draft-get`, `draft-set`, `draft-delete`, `draft-blob-put`, `draft-blob-get`, `get-window-id`, `open-directory-picker`, `open-file-picker`, `read-picked-file`, `release-picked-files`, `save-file-picker`, `save-text-file`, `open-external`, `open-local-file`, `open-path`, `reveal-path`, `read-clipboard-image`, `get-window-focused`, `get-window-fullscreen`, `set-window-focus`, `show-window`, `relaunch`, `get-zoom-factor`, `set-zoom-factor`, `get-pinch-zoom-enabled`, `set-pinch-zoom-enabled`, `set-titlebar`, `run-desktop-menu-action`, `set-background-color`, `export-debug-logs`, `set-force-focus`, `record-fatal-renderer-error`, `set-native-translations`

### Desktop menu actions

`app.relaunch`, `app.quit`, `window.new`, `window.close`, `window.minimize`, `window.toggleMaximize`, `view.reload`, `view.toggleDevTools`, `view.resetZoom`, `view.zoomIn`, `view.zoomOut`, `view.toggleFullscreen`, `edit.undo`, `edit.redo`, `edit.cut`, `edit.copy`, `edit.paste`, `edit.delete`, `edit.selectAll`

## Shared runtime and UI domains

### Core domains

`account`, `command-sandbox`, `config`, `control-plane`, `credential`, `database`, `effect`, `event`, `feedback`, `filesystem`, `flag`, `goal`, `id`, `image`, `installation`, `integration`, `oauth`, `observability`, `permission`, `plugin`, `project`, `pty`, `reference`, `ripgrep`, `session`, `share`, `side-question`, `skill`, `system-context`, `tool`, `util`, `v1`, `workflow`

Notable Core services include database/migrations, config and providers, agents/tools/permissions, sessions and message projection, locations/workspaces, filesystem/git, shell/process/PTY, LSP, MCP/OAuth/resources, hooks/plugins, Memory capture/flush/dream/recovery, goals/tasks/workflows, integrations/credentials, feedback, scheduling, and event transport.

### Session UI and UI primitives

- `packages/session-ui`: markdown/stream workers, message/timeline/turn rendering, tool status/error/attachments, diffs, file/media views, comments, prompt dock, and review surfaces.
- `packages/ui`: reusable Solid components (buttons, dialogs, lists, menus, tabs, inputs, progress, toasts, tooltips, icons, files, diffs, typography, themes, and layout primitives) with Storybook stories.

## Step-by-step audit plan and current evidence

| Step | Scope | Command / procedure | Status |
|---:|---|---|---|
| 1 | Repository rules | Read `docs/rules/README.md`; verify branch is not `main` for changes. | PASS |
| 2 | Type contracts | `bun turbo typecheck --concurrency=2` | PASS: 21/21 tasks |
| 3 | Client generated sources | `bun run check:generated` in `packages/client` | PASS |
| 4 | Legacy JS SDK generated sources | `bun run check:generated` in `packages/sdk/js` | PASS |
| 5 | HTTP API coverage | `bun run test:httpapi` in `packages/apexo` | PASS: coverage 346/346, auth 346/346, effect 346/346; effect-only run 409.09 s, no failures/skips/missing/extra; peak RSS ~3.69 GB |
| 6 | Runtime tests | `GITHUB_ACTIONS=false bun turbo test --concurrency=2` | PASS from Turbo cache: 6 test tasks completed; the repository's prior uncached gate is also recorded in `docs/testing/desktop-cli/2026-10-25.md` |
| 7 | CLI flows | Source CLI help/status/API probes plus focused CLI/ACP suites | PASS: top-level and subcommand help, service status, health API, 51 CLI tests/198 assertions, 17 ACP tests/112 assertions; package build blocked by Bun `1.3.14` vs required `^1.4.4` |
| 8 | TUI flows | Native transport/view/panels, slash arguments, queue, permission/question and footer routing suites | PASS: 43 tests/157 assertions; focused native TUI transport/view/panel tests pass |
| 9 | Desktop/Web UI | App unit/browser/E2E plus Desktop build/typecheck and native smoke flows | PARTIAL: app unit 107/107, Vite build, and Desktop runtime-profile 3/3 pass; browser/E2E entrypoints fail before discovery (GitHub #170); Desktop build is blocked by Bun version guard |
| 10 | Issue triage | Record every confirmed defect under `docs/testing/`, create GitHub issue with reproduction, observed/expected behavior and code location | IN PROGRESS: #170 filed |

The HTTP effect-run observation is tracked separately because it is a test-harness/runtime resource problem; a passing coverage/auth run does not prove effect execution behavior.
