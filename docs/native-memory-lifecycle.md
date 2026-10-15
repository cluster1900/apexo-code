# Native Memory capture and flush — Stage 1

This integrated Stage 1 implementation adds Apexo-owned V2 capture, explicit flush and durable management receipts. It uses the existing native Session runner, permissions, canonical Memory stores and Created-bound lifecycle. It does not use the Grok executable for product behavior. Dream, explicit migration, legacy-backend extraction, managed-role accounting, advanced retrieval and batch work remain open. Existing native Memory browser/terminal controls do not yet expose these new operation actions.

## Shared acceptance checkpoint

The combined headless/Memory/lifecycle gate passed 60 tests / 449 assertions. Refreshed workspace typechecking passed all 21 tasks after the final Memory retry-join and Scheduler refusal corrections. Canonical migration generation/checking, Client and legacy SDK generation, isolated-index generated consistency and the shared Desktop build passed; the real Git index was unchanged. Nine focused Memory HTTP scenarios passed over the 295-route inventory with no failures, skips or missing routes.

Source CLI and rebuilt Desktop each passed five checks with two ordinary and three extraction requests: passive empty behavior, actual observation/index publication, deduplication, real process crash and passive restart, exact recorded-lease retry, and preservation of earlier notes without ordinary Session replay. A fresh installed-reference run passed seven checks with four requests. Its Dream observations remain comparison evidence, not native Dream acceptance. The complete HTTP gate subsequently passed 323 scenarios in each of its three modes over 295 routes, with no failures, skips or inventory gaps. The complete unit gate is running; Stage 1 operation UI and Stage 2 remain open.

## Behavior

Memory remains off by default. An enabled ordinary native Session can capture its last proven terminal turn after the runner finishes its continuation decision. The snapshot includes the exact Session Created proof, prompt and assistant IDs, original agent/model, captured permission authority, terminal disposition and bounded transcript. A turn with an unfinished tool or an agent/model transition is excluded. Automatic work is allow-only: it never opens a permission prompt or adds a synthetic user message.

Stop first settles the assistant and tool fibers, then preserves a stopped-source receipt without launching extraction from its cancellation finalizer. Eligible sources are also checkpointed before actual compaction while Memory is enabled. Their durable snapshots survive projected-history replacement. Enabling Memory cannot reconstruct history that was already compacted while capture was disabled.

Explicit flush freezes the eligible source target at admission, including retained same-incarnation/revision/generation snapshots. It excludes a currently unfinished turn. Canonical prompt admission receipts deduplicate repeated sources. Each extraction makes one tool-free native provider stream with a 120-second deadline and a two-MiB output bound; canonical parsing precedes publication. Observation creation timestamps use Unix seconds, while operation and lease timestamps retain their millisecond contracts.

Created identity, mode revision, Memory scope generation and current/captured authority are revalidated before publication. A changed generation or revoked permission cannot publish late output. Disable, explicit operation cancellation, Session deletion and owner-scope shutdown cancel and join owned work and its storage finalizers outside long Session mutation leases. Ordinary idle Session interruption keeps its existing no-op contract; Memory has a separate cancel action.

Headless input policy suppresses both source observation and auxiliary work. Private managed children, historical quarantined children, active Goals and captured Goal attempts are rejected before auxiliary admission because this slice does not implement their accounting. These are explicit unsupported boundaries, not silent fallback to compatibility execution.

## Durable operations and recovery

`session_memory_operation` is a private, Session-FK-cascaded ledger. Each record stores its Created proof, immutable plan, process owner and token, state/result and exact canonical capture claims. Public responses omit source text, permission snapshots, owner UUIDs and lease tokens.

States are `queued`, `running` and `finished`. Ownership is reported separately as `local`, `unverified` or `settled`. Restart and passive list/get never guess that an owner is dead from elapsed time and never schedule provider work. A crashed `running` receipt remains unverified; cancel refuses to claim it cancelled when this process has no worker to join. A record-only queued source can be explicitly cancelled without a worker.

Reusing an operation ID with the same request returns its existing receipt without scheduling again. A retry uses a new ID and `retryOf`, retaining the original fixed source target. New operations may queue, but strict per-Session Flock serialization prevents concurrent extraction. The opt-in lock policy permits takeover only for a positively verified dead local PID, never elapsed age, unknown/foreign host identity or EPERM.

Before provider work, every claimed capture job's exact owner, token, source hash and job ID are durably appended to the Created-matching operation receipt. Under the strict Session lock, explicit flush/retry may release only those recorded claims through an atomic identity-and-source CAS. Foreign, recycled or unknown claims remain untouched. A crash between canonical claim and receipt publication has no recovery proof and deliberately remains unavailable rather than being stolen. No automatic timer expiry or restart replay is added. Publication already represented in the canonical commit journal is reconciled without another extraction.

The ledger reconciliation bound is 1000 operation receipts and a four-MiB source plan. Exceeding a bound is an explicit failure; there is no silent source truncation or automatic history pruning. The canonical transcript serializer has its own documented bounded text representation. Historical V1 sources are not silently interpreted as native sources, and unattributable legacy capture ownership remains an explicit conflict.

## Native API contract

These additive Session routes use the canonical Session Location middleware:

| Operation | Route | Input/result |
| --- | --- | --- |
| Flush or explicit retry | `POST /api/session/:sessionID/memory/flush` | `{id, retryOf?}` → operation |
| Recent receipts | `GET /api/session/:sessionID/memory/operation` | newest 100 operations |
| Exact receipt | `GET /api/session/:sessionID/memory/operation/:operationID` | operation |
| Cancel | `POST /api/session/:sessionID/memory/operation/:operationID/cancel` | no body → joined operation |

`MemoryOperation.Info` reports ID, Session, capture/flush kind, actual backend, phase/ownership, timestamps, optional retry origin and result. Missing Session/receipt is 404; invalid input is 400; denied/unsupported admission is 403; busy/conflict is 409; unavailable storage is sanitized 503. Started work reports its durable result separately. Stage 1 supports V2; selecting a legacy backend does not switch it implicitly. Root owns final aggregates, SDK generation and canonical migration.

The Location runner imports only `SessionMemoryObserver`, a dependency-light callback capability. Process-global ExecutionLocal supplies the callbacks bound to its original lifecycle claim. Global `SessionMemoryOperation` discovers stored placement; no Location layer constructs SessionExecution or global routing. Headless integration consumes only `SessionExecutionPolicy.forSession`; the canonical policy leaf and promotion wiring are owned by the headless slice.

## Verification and limits

From `packages/apexo`, private `bun test test/v2/memory-lifecycle-native.test.ts test/tool/memory-capture.test.ts test/session/memory-capture-incarnation.test.ts test/session/memory-capture-rollover.test.ts test/tool/memory-mode.test.ts` exercised the existing stores plus the new lifecycle cases. The first expanded run passed 44 cases and failed one newly authored foreign-lease fixture before its ownership assertions; BUG234 records its corrections. All 31 existing capture/mode/incarnation/rollover tests passed. The final fourteen-case lifecycle run passed twelve cases, including corrected foreign-lease and managed-role negatives, but had two phase deadline failures. An unchanged isolated rerun of those two passed 2 tests / 17 assertions. Those timing observations remain unresolved as BUG235; this is not an all-green combined-gate claim.

The new runtime coverage includes real non-noop publication, exact/concurrent admission, source deduplication, pre-compaction preservation, stopped-source admission without automatic work, headless/managed/Goal denial, fresh permission and clear-generation fences, delete/reused ID, controller shutdown, exact owner/token recovery and an unreceipted expired foreign lease that remains unclaimed through explicit retry. Private Core, Apexo and Server package typechecks passed at their final corresponding checkpoints. The strict Flock focused gate passed 3 tests / 13 assertions; one earlier child startup deadline observation remains unclassified in its own evidence.

`bun script/grok-memory-native-lifecycle.mjs cli` passed five real HTTP/provider checks with two main and three extraction requests: empty/passive zero work; actual automatic observation/index publication; deduplication; process crash and passive restart; exact recorded-lease retry without ordinary Session replay. The script supports the coordinated `desktop` backend, but packaged Desktop has not yet been run for this private slice. Shared generation, complete repository gates and final Desktop acceptance remain root-owned pending work. Stage 1 adds no App/TUI UI change.

The installed comparison uses Grok 1.0.52 (`0920c8169e27`) and pinned source `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`. The isolated probe passed seven checks with four provider requests: passive/empty/disabled no-work behavior, one capture, repeated-flush deduplication, one manual Dream and repeated-Dream no-work. One auxiliary request was not classified; no automatic-trigger timing, cancellation or crash semantics are inferred from that probe. Its Dream observation-shape correction is BUG201. Dream evidence is reference-only and does not claim native Stage 2 completion.
