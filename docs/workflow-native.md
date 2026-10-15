# Native Apexo workflows and Deep Research

Apexo owns workflow lifecycle, durable records, child Sessions, permissions, budgets, journal replay, and explicit resume. Product code does not execute Grok Build or include its engine. Official source and an isolated installed binary are behavioral comparison fixtures only.

The native workflow API is rooted at `/api/session/:sessionID/workflow`, with list, start, get, resume, pause, and stop operations. The canonical `workflow` tool uses the same Core runtime. A standalone start records pending work before scheduling the process-global Session coordinator. The Location runner consumes it on explicit execution. Child work uses the exact same coordinator's ownership chain and the parent's Location, model, agent, and permissions. A persistent child marker cannot execute without its live workflow capability. Read-only stages additionally exclude mutation and process tools; every child excludes nested workflows.

The compatibility manager uses `POST /api/session/:parentID/workflow/launch`. Each launch creates a dedicated native host linked through durable parent and metadata fields. The host inherits the selected model, agent, Location, and permission rules, with a bounded immutable snapshot of parent text. The original chat never enters native execution. `GET .../workflow/related` discovers linked runs after reopen; controls address each run's actual host Session ID. V1 execution admission rejects hosts and workflow children while preserving read-only inspection.

`GET .../workflow/sources` discovers built-ins and saved project/user scripts. Project scripts take precedence over saved user scripts with the same name. `POST .../workflow/validate` compiles actual Rhai without creating a run, invoking host operations, or calling a model; syntax diagnostics do not guarantee runtime correctness.

Workflow source can be the native `deep-research` built-in, an Apexo declarative definition, inline Rhai, or a saved Rhai name. Saved names resolve first from `.apexo/workflows/<name>.rhai` in the Session's directory and then from the user's Apexo configuration `workflows` directory. Resolution checks read permissions for both the requested and real path. The selected script and arguments are snapshotted into the durable run; editing the file cannot change a resumed run.

Apexo's small `workflow-script` helper uses the generic crates.io Rhai interpreter. It evaluates bounded language expressions and exchanges JSONL operations with Core. It has no workflow persistence, model client, shell execution, or direct filesystem API. Core handles agent panels, phase/log events, budget queries, private scratch files, templates, and permission-filtered Git evidence. Scratch is limited to 64 files and 16 MB per run, with a 1 MB per-file ceiling. Core separately bounds host values, protocol messages, 10,000 host calls, and 16 MB of durable call receipts; the interpreter is not the sole enforcement boundary. Syntax validation does not establish runtime correctness. Unsupported agent options fail explicitly rather than being silently ignored.

The cumulative agent budget counts logical child reservations. A whole parallel panel is reserved before any child starts. Durable receipts replay completed children after an explicit same-process resume; increasing the budget does not repeat completed work. Child fibers are explicitly scoped, and parent interruption waits for their teardown. Process death preserves records but does not authorize automatic child retries or cross-process resume. A new run is required after process restart.

Deep Research is first-party policy: plan distinct questions, investigate in bounded read-only parallel children, independently verify each research result, then synthesize a report. Structured output is validated against JSON schemas. The report cannot cite URLs absent from accepted verification evidence, and the verifier cannot introduce URLs absent from research. This establishes provenance consistency; it does not mechanically prove a factual claim true.

## Verification

With Bun 1.3.14, run from `packages/apexo`:

- `bun test test/workflow/engine.test.ts`: seven tests, 33 assertions passed for reservations, replay, interruption, same-process resume, invalid output, durable journal capacity, and late settlement preserving explicit control.
- `bun test test/workflow/scratch.test.ts`: three tests, 14 assertions passed for traversal, symlink and hard-link rejection, aggregate file/byte limits, and preservation of external files.
- `bun test test/workflow/limits.test.ts`: three tests, ten assertions passed for host receipt counts, cumulative serialized bytes, and UTF-8 value limits.
- `bun test test/e2e/v2-workflow.e2e.test.ts`: one test, nine assertions passed using real native HTTP execution, six research children, and one actual Rhai child.
- `bun script/grok-workflow-native.mjs cli`: five production scenarios passed with 11 provider calls: research, saved-source budget resume, private scratch, interruption/resume, and process-death recovery boundary.
- `bun script/grok-workflow-native.mjs desktop`: five production scenarios passed with 11 provider calls against the rebuilt Electron backend and staged interpreter, using the same resource environment as real Desktop startup.
- `bun script/grok-workflow-native.mjs cli --ownership`: seven scenarios passed with 12 calls, including stale-run interruption isolation and cancellation after pause or budget exhaustion. The rebuilt Desktop artifact also passed seven scenarios and 12 calls, including the final guarded-capture and paused-stop backend changes.
- `bun script/grok-workflow-bridge.mjs cli`: five checks passed with two provider calls for discovery, compile-only validation, independent compatibility hosting, immutable context, inherited deny rules, V1 admission guards, owner-scoped controls, and durable association. The rebuilt Desktop repeat also passed five checks with two provider calls.
- `bun script/grok-workflow-official.mjs`: isolated installed reference comparison passed two checks with two provider calls and one independent workflow child; the typed terminal notification and result were verified.

From `packages/workflow-script`, `cargo test --locked` passed three first-party interpreter tests. `cargo build --release --locked` succeeded locally. These are Apexo's tests, not upstream-engine tests. The earlier experimental vendored package was removed and its 62 tests are withdrawn as feature evidence.

## Remaining acceptance and interfaces

Saved-script panel management, user-facing slash commands, script validation UI, and the workflow dashboard are not yet claimed here. Cross-platform packaging requires target-specific verification. Agent model/effort overrides, context forks, worktree isolation, and schema retry policy require further implementation; unsupported Rhai agent options currently fail closed. A schema or child failure is recorded as failed instead of being silently retried. Workflow token statistics currently describe successful child receipts; this is separate from the cumulative logical-agent cap.

Related records: [terminal control](testing/runtime/workflow-script-terminal-control.md), [child teardown](testing/runtime/workflow-child-scope-cancellation.md), [provider fixture finish](testing/test-fixtures/workflow-provider-finish.md), and [Location exposure](testing/runtime/workflow-source-registration.md).

## Script user checkpoints

`await_user(kind, message)` commits its null host-call receipt and paused status together before interpreter teardown. The public run includes `pauseKind`. Explicit same-process resume replays the receipt and continues after that checkpoint; a child after it cannot execute beforehand. Resume remains busy until the old execution scope closes. Cancellation and cleanup failures cannot overwrite the committed control state. Cross-process recovery remains unavailable.

`pause(kind, message)` remains terminal on every evaluation, so an unchanged script pauses again after resume. Canonical kinds are `user`, `back_off`, `no_progress`, `verification`, and `infra`; `backoff` and `blocked` normalize to `back_off` and `verification`. Invalid kinds fail. `complete()` terminates with a null result, including inside a script catch block.

Verification for this slice: Workflow tests passed 19 tests and 84 assertions, including five actual Store/interpreter tests for teardown visibility, replay, cancellation before and after checkpoint commitment, and capacity preflight. The first-party interpreter passed five Rust tests. Core and Apexo typechecks passed. `bun script/grok-workflow-checkpoint.mjs cli` passed four scenarios with one provider call. The isolated installed-runtime comparison with `--checkpoint` passed three checks with two provider calls and one actual workflow child. The rebuilt Desktop checkpoint fixture also passed four scenarios with one provider call. These are Apexo implementation tests and isolated comparison evidence, not upstream engine test claims.
