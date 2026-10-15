# Native Memory Dream and explicit migration

This Stage 2 backend extends [native capture/flush ownership](native-memory-lifecycle.md) inside Apexo. It uses the canonical Memory stores, native model service, permission snapshots, Session lifecycle and durable operation controller. Grok is a behavior reference only; no product execution depends on its executable.

## Supported behavior

Native V2 Dream is available as an explicit operation and as an eligible follow-up to successful live automatic capture. Manual Dream bypasses count/age eligibility only. Enabled mode, rollout, model selection, configured manual/automatic switches, Session Created proof, current and captured permissions, and scope generation remain authoritative. Automatic eligibility is checked before durable admission and again before execution. A mere status read, Session load or server restart does not start model work.

Dream makes one bounded, tool-free native model request. Existing canonical parsing validates the six operation forms, evidence, paths and byte limits. Active publication and shadow evaluation reuse the canonical store, including topic/index convergence and observation archiving. Managed children, headless inputs and active/captured Goal attempts reject auxiliary work before provider admission; usage integration for those roles remains open.

Each operation records its exact original Dream lease before inference. A strict dead-owner-only scope lock prevents different Sessions sharing one store from claiming live/unknown ownership. An elapsed timeout is not recovery proof. Explicit retry can recover only the recorded ID/owner/token/shadow; a joined release does not transfer a prepared plan to an unrelated Session or compatibility caller. Prepared-plan recovery reuses the stored output without inference. A completed domain receipt reconciles the management receipt even after its own successful generation change.

Cancellation, mode disable and deletion join owned work. Fresh permission/mode/generation/Created checks precede publication; a late response cannot publish after revocation or target a reused Session. No cancellation finalizer schedules a model request. Already settled capture results remain immutable if subsequent automatic-follow-up preparation is interrupted.

## Explicit migration

Preview and apply use fixed sources derived from the stored Location and the requested global/workspace scope. Callers cannot supply arbitrary paths. Preview bounds file reads, rejects redirected sources, and reads an existing Memory generation without creating a missing store. It does not run a model, migrate, or change the pinned backend.

- `carryover` imports retained legacy Markdown into one canonical curated V2 topic, keyed by canonical source identity and content hash. The import journal survives reopen, forget and clear so exact historical sources do not resurrect. A new import after a clear cutoff is rejected. Original source bytes remain unchanged.
- `relocation` moves legacy workspace content into the stable project destination while retaining the source. Exact source, previous target and generation hashes are checked under storage ownership. A prepared receipt precedes target publication; an explicit retry recognizes an exact already-published target and completes its marker without duplicating notes. An implicit compatibility read refuses a pending explicitly owned relocation.

Apply uses a durable operation ID and the exact preview. Exact retries are passive; conflicting ID/preview reuse fails. Native migration is deliberately explicit, whereas the pinned reference performs curated carryover at Session start. The native mapping preserves Markdown in one topic rather than claiming complete equivalence to the reference's section/topic naming.

## Public backend contract

Existing capture/flush/read/cancel endpoints remain. Added routes are:

- `POST /api/session/:sessionID/memory/dream` with `{id, retryOf?}`.
- `GET /api/session/:sessionID/memory/migration?kind=relocation|carryover&scope=workspace|global`.
- `POST /api/session/:sessionID/memory/migration` with `{id, retryOf?, preview}`.

Preview contains `kind`, `scope`, `sourceHash`, `targetHash`, `generation` and `available`; it contains no source body or arbitrary filesystem target. Operation kind adds `dream` and `migration`; result may include `topics` and `shadow`. Declared denied/unsupported requests use 403, conflicts 409, invalid requests 400 and unavailable storage 503. Public generation and packaged acceptance are coordinated at integration.

The Core database operation row schema is unchanged: its private JSON uses the recorded kind to decode the exact plan variant. Canonical Memory databases initialize their own additive `dream_ownership` and `memory_imports` tables. No new Core migration is required for Stage 2.

## Verification and reference boundary

The backend and reordered-preview regression are now integrated. Shared validation passes 68 tests / 436 assertions, all 21 workspace typecheck tasks, canonical Client/legacy SDK generation and isolated-index generated consistency. Expanded route coverage and authorization each pass 326 scenarios over 298 routes; focused Effect mode passes 12 Memory scenarios. Fresh App, compiled CLI and Desktop builds pass. Shared source CLI and rebuilt Desktop backend now each pass six checks, with two ordinary, two extraction and three Dream calls. The shared crash script passes ten checks across the prepared and completed boundaries, with exactly one ordinary, one extraction and one Dream request per case and no additional retry inference. Every process exited and was reaped. These are backend results, not operation-management UI acceptance. The earlier shared timeout observations remain unresolved under [BUG271](testing/test-stability/native-memory-shared-validation-timeouts.md) and [BUG272](testing/test-stability/httpapi-auth-probe-startup-timeout.md); private results below are retained separately.

The final private scoped gate passed **68 tests / 434 assertions across nine files**. Core, Apexo and Server package typechecks passed; Apexo was rechecked after the final production edits. Private real native tests cover manual publication, passive exact retry, automatic eligible capture, shadow behavior with capture disabled, cancellation, permission revocation, mode disable, Session deletion/reuse, unsupported authority, and legacy relocation without switching the pinned backend. Canonical storage tests retain compatibility Dream and workspace behavior. The Stage 1 ordinary capture receipt-count assertion remains unchanged.

Actual CLI acceptance passed six checks with two ordinary, two extraction and three Dream calls. A separate CLI crash script parks only after actual SQLite COMMIT, kills/reaps the owned host, and proves both prepared and completed Dream recovery: five checks for each boundary, with exactly one ordinary, one extraction and one Dream call per case. Neither retry adds inference. Real filesystem child crashes after relocation journal publication and target rename prove exact recovery and source preservation.

Installed Grok 1.0.52 comparison passed eight checks / four provider requests in isolated HOME, GROK_HOME and XDG paths: Session-start curated carryover preserving/deduplicating the source with zero calls, passive list, empty flush/Dream, completed-turn flush, repeat flush, manual Dream, repeat Dream and disabled behavior. It does not prove installed crash recovery or automatic eligibility timing. Source reference is revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, especially `v2_memory_dream.rs`, `memory_carryover.rs` and `v2_carryover.rs` in the respective shell/Memory crates.

Run package tests from `packages/apexo`; run `bun typecheck` in Core, Apexo and Server. Shared runtime commands are:

```sh
bun script/grok-memory-dream-native.mjs cli
bun script/grok-memory-dream-native.mjs desktop
bun script/grok-memory-dream-crash.mjs
```

The installed comparison is `bun script/grok-memory-dream-reference.mjs` (optional `GROK_BIN`). Its retained eight-check/four-request private result is separate from the new shared runtime passes; a fresh shared reference run is still pending. Desktop acceptance used the coordinated rebuilt artifact containing this slice and the text-conversion amendment. The private clear/recovery draft is excluded.

## Remaining work

This is a scoped integrated backend, not completion of G05/G07. Native legacy Dream/flush, UI actions for these new operations, advanced retrieval/batch behavior and complete native clear/recovery remain separate deliverables. If deletion removes the sole management receipt for an orphaned prepared Dream, another Session cannot inherit its authority: the plan remains explicitly unavailable. A later authorized discard/clear design must preserve unrelated claims and never replay unknown work. No automatic timer recovery, full managed-role auxiliary accounting, or parity claim beyond the evidence above is implied.
