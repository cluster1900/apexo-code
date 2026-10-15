# Automatic native legacy Memory

Apexo now owns legacy idle and pre-compaction flush scheduling through its native Session execution lifecycle. The earlier explicit flush and deterministic metadata stages remain in place. No Grok executable or orchestration code is embedded.

## Ownership and admission

Each actual process-local Session activity captures a lifecycle Claim and an automatic epoch. Successful live activity captures a bounded completed source, Memory mode revision and maintenance generation before the drain returns. The timer waits for that activity to settle and remain idle; it checks for ordinary pending inputs before sleeping and again before admission. `idle_timeout_secs: 0` disables idle scheduling, and `enabled: false` suppresses both automatic triggers.

A new durable prompt invalidates prior automatic work synchronously, including `resume: false` admission. Interruption joins occur after releasing the short Session input-admission fence. Exact retries of existing inputs do not invalidate the epoch or create new work. The shared pending-input query retains its ordinary-input predicate, excluding Task launch-bound delivery. Prompt handling remains uninterruptible through durable admission and observer joins, so caller cancellation does not orphan prior work.

Accepted Stop of active Session work invalidates and joins automatic work. Idle Session Stop remains a no-op; a running automatic Memory operation can be explicitly cancelled through its existing receipt endpoint. Deletion, mode revision, current authority and clear generation also revoke publication. Maintenance and destination leases are acquired before the final admission fence and mode commit. That final short fence orders publication against new prompt admission without retaining a lock through model inference.

## Compaction and durable receipts

Real manual and automatic compaction provide a structured boundary: compaction ID, last completed assistant ID and durable sequence, actual request estimate, model context and output reserve, and native compaction threshold. The configured `soft_threshold_tokens` is headroom below that threshold. Source capture happens before projection changes. Manual compaction now obtains durable entries from SessionHistory and lowers that same selected context for budget estimation; it no longer substitutes array indexes and an empty request.

Automatic receipts use the Created identity, mode revision, generation and captured sources as deterministic identity. Successful, empty, failed and cancelled receipts remain visible through the existing Memory operation API. Passive list/get, exact operation retry, and a fresh process do not launch a replacement provider request. Ordinary explicit retry retains its original source policy. No durable drain identity or synthetic Session-end event is introduced.

## Evidence and boundaries

Verification uses pinned Bun 1.3.14 in a coherent private checkpoint with workspace links remapped and vendored links preserved. Commands run from the named package directories.

- Apexo `bun script/grok-memory-automatic-native.mjs cli`: nine checks passed, ten ordinary requests, six automatic flush requests and two summary requests.
- Desktop `APEXO_CHANNEL=dev APEXO_VERSION=0.0.0-memory-auto bun run build`: passed on final production source. The unchanged target-native Workflow artifact from the same source checkpoint was supplied through `APEXO_WORKFLOW_ARTIFACTS`.
- Apexo `bun script/grok-memory-automatic-native.mjs desktop`: the same nine checks and counts passed against that rebuilt backend.
- Apexo input/Task regression (`input-execution`, `task-created-admission`, `task-message`): three tests / 134 assertions passed.
- Apexo focused final ownership gate: four tests / sixteen assertions passed, covering joined resume, caller cancellation, final publication and accepted Stop.
- Apexo `bun test test/v2/memory-legacy-native.test.ts test/v2/memory-lifecycle-native.test.ts --timeout 30000`: 56 tests / 277 assertions passed, including all 42 legacy cases and all 14 existing V2 lifecycle cases.
- Core and Apexo `bun typecheck`: passed on final source.
- Apexo `bun script/grok-memory-legacy-reference.mjs`: exit zero; backend-probe-only, zero provider requests, effective V2 artifacts, `definitiveLegacy: false`. Isolation controls confirmed owned provider/workspace access and denied real-home/unrelated-port access.

An earlier five-file Memory run passed all 40 then-existing legacy cases but later reported V2 settlement and Dream lease/deadline failures under concurrent host validation; that run was intentionally interrupted and is not a passing full regression. Two initial source backends also exceeded readiness before reaching Session creation. The serial CLI/Desktop runs verify the behavior but do not establish a timing repair. The unresolved observations remain in [BUG163](testing/test-stability/native-terminal-backend-readiness.md) and [BUG271](testing/test-stability/native-memory-shared-validation-timeouts.md).

The public acceptance script uses the actual source CLI and rebuilt Electron backend through native HTTP endpoints. It checks idle flush, exact and passive retry, admit-only invalidation, idle and active Stop, original source capture before compaction, terminal no-work/failure receipts and passive backend reopening. These are backend checks, not interactive GUI acceptance.

Grok Build source reference remains revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`. Its `session/acp_session_impl/run_loop.rs` arms idle work and skips unchanged conversation; `session/compaction.rs::maybe_pre_compaction_flush` captures source before background flush and applies cycle/threshold guards; `session/acp_session_impl/memory_dream.rs::run_memory_flush` serializes legacy inference and writes accepted summaries. Apexo implements those behaviors with its own durable receipts, lifecycle claims, input fence and canonical provider. Upstream tests are not Apexo verification.

The isolated installed Grok 1.0.52 legacy probe still exposes V2 artifacts despite requested legacy configuration. Its zero-provider result is backend detection only, with `definitiveLegacy: false`. Installed legacy runtime equivalence remains unresolved; automatic legacy comparison is source-only. Legacy Dream, batch Dream and vector retrieval remain outside this tranche.

See [the final publication race](testing/runtime/native-memory-automatic-publication.md), [manual compaction source correction](testing/runtime/native-memory-manual-compaction-source.md), [joined-resume correction](testing/runtime/native-memory-joined-resume.md), and [exact retry fixture correction](testing/test-fixtures/native-memory-automatic-retry.md).

## Shared integration checkpoint

The 20-file handoff was integrated with every baseline and final SHA256 verified. Shared source CLI passes the same nine checks and request counts. The shared legacy/V2 Memory plus input/Task regression passes **59 tests / 411 assertions across five files**, with zero failures. The combined shared Desktop has now been rebuilt and passes the same nine checks with ten ordinary, six flush and two summary requests. All 21 workspace types pass.
