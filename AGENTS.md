- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- The default branch in this repo is `main`; use `main` or `origin/main` for diffs.

## CI Gate

- Never commit or push directly to `main`, and never merge into `main`, unless the GitHub Actions `test` and `typecheck` checks pass.
- Make every change on a branch and open a PR to `main`.
- Branch protection on `main` enforces this: the `unit (linux)` (from `test.yml`) and `typecheck` checks are required, admins are included, and force pushes and branch deletion are blocked.
- Wait until CI on the PR is green before merging. If a check fails, fix it on the branch and push again; do not merge around it.
- Before pushing, run the same checks CI runs, from the repo root:
  - `bun turbo typecheck --concurrency=2` (`typecheck.yml`)
  - `GITHUB_ACTIONS=false bun turbo test --concurrency=2` (`test.yml`)
  - `bun run check:generated` in `packages/client` (`test.yml`)
  - `bun run check:generated` in `packages/sdk/js` (`test.yml`)
  - `bun run test:httpapi` in `packages/apexo` (`test.yml`)

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `apexo`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@apexo/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/apexo`.
- On the pinned Bun 1.3.14, a POST body that the handler never reads, combined with an async reply, makes `node:http` `server.close()` hang. The test then stalls for about 20s and fails with `All fibers interrupted`. Send POST requests to endpoints that have no payload without a body, as the real clients do. See `docs/known-issues.md`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/apexo`), never `tsc` directly.

## Bug Records and Recurring Constraints

- Write all documentation (`docs/`), bug records (`docs/testing/`), and constraints (`docs/rules/`) in English.
- **Before changing code**: Read `docs/rules/README.md` and any applicable constraints in `docs/rules/`, and follow them during implementation and verification. Do **not** read `docs/testing/` before coding (to avoid context bloat); only inspect `docs/testing/` during testing or when recording a bug fix.
- **When fixing a bug or test failure**: Create or update a record under `docs/testing/` before declaring the fix complete. Organize records by bug type (for example, runtime, permissions, persistence, UI, types, or test fixtures); reuse an existing record for the same root-cause bug instead of duplicating it.
- Record the bug ID, affected scope, observed and expected behavior, reproduction steps, root cause, fix, and verification commands/results. Temp logs under `/tmp` may be used freely during runs, but do not record `/tmp` paths or ephemeral directory names in the docs. Keep unresolved symptoms and unknown root causes explicitly marked; a passing rerun alone does not prove a fix.
- **Promote to `docs/rules/` only when genuinely recurring (3–5 times)**: When the exact same bug or root-cause mistake has occurred 3 to 5 times across independent runs, fix it and write an actionable constraint under `docs/rules/`, linked in both directions to its bug record. Do not count duplicate references to one failure or unrelated bugs with similar symptoms as separate occurrences.
- Maintain the active constraint index (including a one-line `MUST / NEVER` summary per rule) and count in `docs/rules/README.md`. If the active count exceeds 300, consolidate similar constraints until there are at most 300 active constraints. Preserve their effective requirements, applicability, source bug links, and an old-ID-to-new-ID mapping; do not silently discard constraints to reduce the count.
- Never invent historical occurrences or mark an unverified fix as verified.

## Grok Build Feature Parity Scope

- Implement missing user-facing capabilities inside Apexo's own architecture. Apexo remains authoritative for Sessions, model execution, permissions, tools, persistence, CLI, and Desktop.
- Use Grok Build source and isolated installed-runtime runs as behavioral references and comparison evidence. Do not embed the Grok Build runtime, vendor its orchestration engine, or make migrated product features depend on its executable.
- Generic libraries may support an implementation, but feature orchestration and lifecycle must remain Apexo-owned. Do not count upstream tests as verification of Apexo's implementation.
- Direct official-runtime integration and a Desktop adapter for official Grok sessions are not deliverables of this feature-parity task. Existing optional integrations remain separate from the migrated features.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
