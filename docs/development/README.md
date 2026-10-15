# Developer handoff: Grok Build capability parity

This is the starting point for reviewing and continuing the current Apexo work. **Development is paused at the user's request after this documentation handoff.** No further implementation, integration, commit, push or merge is scheduled. Resume only after the user's review and instructions.

## Read in this order

1. [Review checkpoint](progress.md): what is implemented, what is verified, and what remains unfinished.
2. [Remaining task board](task-board.md): bounded work packages, code entrypoints and acceptance requirements.
3. [Repository instructions](../../AGENTS.md) and [recurring constraints](../rules/README.md), then the applicable package instructions.
4. The feature document linked from the checkpoint for the area you will change.
5. [Historical implementation record](../grok-build-implementation-progress.md) only when older evidence is needed. Its dated checkpoints are historical, not cumulative acceptance of today's source.

All repository documentation is English, as required by AGENTS.md. G01–G13 are feature groups containing both completed and unfinished work; they are not thirteen missing features. There is no defensible overall completion percentage because the remaining contracts differ greatly in size and some still need reference validation.

## Workspace and review boundary

- Current branch: `grok-agent-roadmap`; base branch for comparison: `main` / `origin/main`.
- HEAD at handoff: `3ac66232d9900e85d1e01c750315431552099ce7`.
- The feature work is largely **uncommitted**, including many new source and test files. `git diff` alone omits untracked files. Review `git status --short`, tracked diffs, and the new files together.
- Preserve the current branch and worktree. A checkout created from HEAD alone will not contain this work. Coordinate a complete snapshot before independent checkout development.
- Portable unmerged work is under [handoffs](handoffs/README.md). Those patches/designs are review artifacts, not installed production features.
- The [changed-file inventory](review-change-inventory.json) records hashes at handoff. It is not a backup and does not replace preserving the actual files.

Useful read-only review commands from the repository root:

```sh
git status --short --branch
git diff --stat
git diff origin/main -- packages/core/src
git ls-files --others --exclude-standard
```

Do not commit or push directly to main. New branches use at most three hyphen-separated words, without a slash. Use conventional commit/PR titles. A PR may merge only after required GitHub Actions checks pass; the current incomplete aggregate is not merge approval.

## Architecture and ownership

The objective is to implement missing capabilities **inside Apexo**. Grok Build is a behavior reference. Its executable and orchestration engine must not become dependencies of migrated features.

| Package | Responsibility | Start here |
| --- | --- | --- |
| `packages/schema` | Shared domain values and wire schemas | `src/session*`, `src/host-*`, relevant domain schema |
| `packages/core` | Native Session lifecycle, tools, permissions, persistence and domain services | `src/session`, `src/tool`, `src/system-context` |
| `packages/protocol` | Public HttpApi endpoint contracts | `src/groups` |
| `packages/server` | Native handlers, middleware and service composition | `src/handlers`, `src/api.ts` |
| `packages/client` | Generated Promise/Effect clients | [Client guide](../../packages/client/README.md) |
| `packages/sdk-next` | Composition of Client, Core and Server | Package entrypoints |
| `packages/apexo` | CLI, compatibility runtime and adapters, integration fixtures | `src/cli`, `src/session`, `src/server`, `test`, `script` |
| `packages/app` | Shared SolidJS browser/Desktop renderer | `src/components`, `src/context`, `src/i18n` |
| `packages/tui` | Shared mini/fullscreen panels and terminal UI | `src/component`, `src/util` |
| `packages/desktop` | Electron host, preload and bundled server/resources | `src`, `scripts` |
| `packages/workflow-script` | Apexo's Rust/Rhai interpreter | `src`, `script/artifact.ts` |
| `packages/sdk/js` | Legacy generated JavaScript SDK | `script/build.ts` |

Runtime dependency direction is Schema → Core/Protocol → Server. Client runtime may depend on Schema and Protocol, never Core or Server. A generator reading Server at build time does not permit a browser runtime import of Server.

### Native Session execution

The critical flow is durable prompt admission → process-global Session execution coordinator → Location-scoped runner → one explicit provider stream per turn → durable events/history. Start with:

- [Prompt admission](../../packages/core/src/session/input-admission.ts), [input execution](../../packages/core/src/session/input-execution.ts).
- [Execution service](../../packages/core/src/session/execution.ts), [local coordinator binding](../../packages/core/src/session/execution/local.ts), [run coordinator](../../packages/core/src/session/run-coordinator.ts).
- [Runner](../../packages/core/src/session/runner/index.ts), [provider turn](../../packages/core/src/session/runner/llm.ts), [history](../../packages/core/src/session/history.ts).
- [Child placement](../../packages/core/src/session/child-placement.ts), [Task messaging](../../packages/core/src/session/task-message.ts), [lifecycle ownership](../../packages/core/src/session/lifecycle.ts).

Do not replace durable admission with an in-memory tool loop, bridge native execution through legacy `SessionPrompt.loop`, or use a drain as a durable transcript boundary. Exact prompt retries reconcile existing admitted input. Steers and queued inputs have different promotion boundaries. Placement, current permissions, Session incarnation and cancellation must remain authoritative across asynchronous work. AGENTS.md contains the complete invariants.

### Two independent distinctions

Native V2 and compatibility are different execution architectures. Mini/fullscreen and browser/Desktop are presentation surfaces. A native backend passing a fixture does not prove the native window was exercised. Likewise, a compatibility implementation is not proof of native V2 support. Feature documents label these boundaries.

## Local setup and running

Use **Bun 1.3.14**, pinned in the root package.json. Use a Rust toolchain with the target/linker needed by `packages/workflow-script` when building its interpreter. Desktop requires Electron's package dependencies. Do not change the lockfile merely to work around a different local Bun version.

From the repository root:

```sh
bun --version
bun install --frozen-lockfile
bun dev --help
```

Interactive CLI in your own terminal:

```sh
bun dev . --session-protocol native --mini
bun dev . --session-protocol native
```

The first command opens mini; the second opens fullscreen. Default `bun dev .` remains a separate compatibility path. Inspect the selected command's help before assuming a native option also works on compatibility or attached servers. For automated terminal work, follow [the package instructions](../../packages/apexo/AGENTS.md): use an owned tmux session and stop it explicitly, rather than leaving a blocking foreground TUI.

For web development, run these in separate terminals from the root:

```sh
bun dev serve --port 4096
```

```sh
bun dev:web
```

Select the development backend in the App. [App setup](../../packages/app/README.md) documents its server and Playwright configuration. For Electron development:

```sh
bun dev:desktop
```

Desktop predev builds/stages its sidecar. A source edit does not automatically make an old packaged backend current. Inspect [Desktop setup](../../packages/desktop/README.md) and its prebuild scripts before packaged acceptance.

Workflow builds can compile the target-native interpreter through Cargo. `APEXO_WORKFLOW_SCRIPT` selects a built interpreter for runtime fixtures; `APEXO_WORKFLOW_ARTIFACTS` points packaging at a directory containing target triples and their native executable. These are distinct inputs. Never substitute a macOS executable for a Linux/Windows target. `MODELS_DEV_API_JSON`, when used by fixtures, must point to a controlled model-catalog fixture. Personal credentials and local test directories do not belong in documentation or commits.

## Editing and generated files

Read `docs/rules/README.md` before code changes and only the applicable rules. Read `docs/testing` during testing or bug recording, not as a prerequisite to every edit. Keep runtime changes in their owning domain; keep App/TUI as adapters over authoritative APIs.

After a public Protocol or Server HttpApi change, run from `packages/client`:

```sh
bun run generate
```

After changing the legacy API surface, run from the repository root:

```sh
./packages/sdk/js/script/build.ts
```

Do not edit Client `src/generated` or `src/generated-effect` by hand. Finish generators before starting their readers, builds or suites. The same source tree must not be regenerated while a test process imports it. Database schema/migrations belong to Core; follow that package's existing migration generation/checks when persistence changes.

User-facing storefront terminology is **Plugins**, translated through the existing locale dictionaries. There are 62 App locale dictionaries. A passing English window is not evidence for every translation; record rendered locale coverage separately.

## Verification workflow

First run focused tests in their package directory and `bun typecheck` in each affected package. Use actual service behavior rather than duplicated test logic; keep real providers local to isolated fixtures where possible. Do not raise deadlines to conceal unknown hangs.

Example from `packages/apexo`:

```sh
bun test test/v2/memory-batch-dream-native.test.ts test/v2/memory-batch-dream-protocol.test.ts
bun typecheck
```

For each feature, run its source CLI fixture, rebuild App/Desktop, run the rebuilt Desktop fixture, and separately run the supported isolated Grok comparison. Add actual window and mini/fullscreen checks if UI changed. Script names and contracts are linked from [the task board](task-board.md); inspect flags in the script before running. Fixture-owned processes and data must be disposed after each run. Do not restart unrelated user applications or containers.

Before pushing, the required repository-root orchestration is:

```sh
bun turbo typecheck --concurrency=2
GITHUB_ACTIONS=false bun turbo test --concurrency=2
```

Then, from `packages/client`:

```sh
bun run check:generated
```

And, from `packages/apexo`:

```sh
bun run test:httpapi
```

The root `bun test` guard is intentional; Turbo delegates to packages. Never call tsc directly. `check:generated` compares generated outputs with the Git index, so an uncommitted generated candidate differs from the old index even when deterministic. Earlier candidate checks used an isolated index and preserved the real one; after reviewing/staging intended changes, run the actual required check before push.

The latest complete unit run took about 24 minutes and the complete three-mode HTTP run about 12 minutes on this host. These are observations, not completion estimates. Serialize generation and heavyweight local gates; independent source review can proceed in parallel. Freeze/capture source identity across acceptance so results correspond to a known build.

## Bug records and completion criteria

Every bug/test-failure fix needs an English record in `docs/testing`, grouped by root-cause type, before being declared complete. Reuse an existing record for the same cause. Record reproduction, expected/actual behavior, cause, repair and commands/results; mark unknown causes explicitly. Passing a rerun is not proof of repair.

After 3–5 independent occurrences of the same root-cause mistake, promote a constraint into `docs/rules`, with bidirectional links and an updated active count. The handoff has 26 active constraints. Consolidate similar constraints if that count exceeds 300 without discarding effective requirements.

A feature is complete only when its intended behavior is integrated, its meaningful checks pass on the shared code, the relevant CLI/Desktop/reference boundaries are documented, and remaining limitations are explicit. Private agent tests, an older aggregate, or upstream tests alone do not satisfy this definition. Review and explicitly select the next work package before resuming development.
