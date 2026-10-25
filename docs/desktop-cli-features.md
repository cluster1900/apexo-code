# Desktop and CLI feature inventory

Audit date: 2026-10-25 (America/New_York). Source baseline: `a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2`.
Branch: `desktop-cli-validation`. This inventory defines test scope, not proof that features work.

## Product surfaces

| Surface            | Entry point                                | Responsibility                                                                 |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Desktop            | `bun run dev` in `packages/desktop`        | Electron main/preload, native menus/dialogs, renderer and bundled Node sidecar |
| Primary CLI        | `bun run src/index.ts` in `packages/apexo` | Interactive terminal, headless runs, session/provider/project management       |
| Preview CLI        | `bun run src/index.ts` in `packages/cli`   | V2 API operations, background service and TUI                                  |
| Packaged CLI       | `packages/apexo/bin/apexo`                 | Platform executable resolution and argument forwarding                         |
| Shared application | `packages/app`                             | Sessions, composer, settings, tools, files, terminal and management panels     |

Antigravity is a provider using the native `agy` login. It does not replace Apexo's session engine, tools, permissions or persistence. An installed Antigravity desktop application alone does not establish that the separate `agy` CLI credential exists.

## Capabilities and expected user journeys

| Area            | Capabilities                                                               | User journey / observable contract                                                                                                                            |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup         | Desktop boot, sidecar connection, CLI help/version, errors                 | Launch -> ready UI/prompt; actionable error if prerequisites are absent                                                                                       |
| Providers       | Native Antigravity login, connection state, catalog and reasoning tiers    | Connect -> choose available model -> real response; preserve native credential ownership                                                                      |
| Projects        | Open directory, project picker, filesystem context                         | Choose a disposable repository -> file/tools operate in that repository                                                                                       |
| Composer        | Multiline input, attachments, slash commands, model/agent/reasoning choice | Compose -> send once -> visible user message and streamed assistant response                                                                                  |
| Coding          | Read/search/write/edit/shell, multi-step continuation                      | Solve a small fixture task -> independently verify files and executable tests                                                                                 |
| Sessions        | New/list/search/rename/resume/fork/archive/import/export                   | Retain transcript and directory/model identity through each operation                                                                                         |
| Running work    | Interrupt, steer, queue, background work, task dashboard                   | Visible lifecycle; no silently lost prompts; stop affects intended session                                                                                    |
| Permissions     | Ask/allow/deny, sandbox, external-directory access                         | Ask before protected action; denial prevents side effect; scoped approval permits it                                                                          |
| Inspection      | Tool details, reasoning, timeline, usage, trace, diffs                     | UI and CLI reflect persisted events and actual output                                                                                                         |
| Advanced work   | Goals, workflows, side questions, agents, plans                            | Start -> observe status -> complete or actionable failure; retain parent session                                                                              |
| Memory          | CLI status; capability-gated Desktop browse/review/operations              | Correct empty state, scoped changes and visible outcomes. V1 management is exposed by the grok-build runtime profile; the default Apexo profile hides this UI |
| Integrations    | MCP, plugins, hooks, ACP, JSONL                                            | Valid connection/protocol lifecycle; invalid input yields actionable errors                                                                                   |
| Settings        | General, shortcuts, servers, providers, plugins, MCP, models               | Open every page; controls work, state persists across navigation                                                                                              |
| Layout          | Light/dark, language, narrow window, keyboard focus, dialogs               | No hidden primary actions, overlapping controls or stranded modal state                                                                                       |
| Native features | File chooser, menus, multiple windows, logs                                | Native action reaches correct renderer flow and output file                                                                                                   |
| Service         | Health, authentication, API, attach                                        | Correct endpoint responds; wrong credentials rejected; client can connect                                                                                     |
| Reliability     | Invalid model/path/input, quota/network failures, cancellation             | No false success, infinite busy state, credential leakage or unrelated data loss                                                                              |

## CLI command inventory

Primary CLI: default TUI, completion, acp, mcp, attach, run, debug, providers/auth, agent, uninstall, serve, web, models, stats, usage, trace, export, import, pr, session, plugin/plug, db, jsonl, memory, goal and plugins. Use current help as the authority for exact flags.

Preview CLI: default TUI, api, debug agents, migrate, service start/status/stop/restart/password and serve. Migration, uninstall, credential deletion and service restart are inspected without altering existing user data.

## Coverage boundaries

macOS is the available platform. Local unsigned macOS directory packaging is included; signing, notarization and installer distribution are not claimed. Linux/Windows installers, native credential stores, real first-time OAuth, paid/quota-dependent models and external service integrations require their corresponding environments. A blocked prerequisite must be reported separately from a product defect. Existing app/server processes must not be restarted (application repository instruction).

The earlier uncommitted inventory described a partial 2026-10-24 audit at `6c466aa`. Its observations are historical and are not reused as current PASS results.
