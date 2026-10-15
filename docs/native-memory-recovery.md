# Native Memory recovery

Status: reviewed implementation integrated into the shared branch. Shared tests, source CLI, Core/Apexo types and client generation pass; rebuilt packaged Desktop acceptance passes; native operation UI acceptance remains pending.

An explicitly authorized native Session can inspect a bounded recovery preview, discard one unchanged abandoned prepared Dream plan, or clear a canonical workspace/global Memory scope. These actions use Apexo's existing Memory stores, permission authority and durable operation controller. They do not invoke a provider, admit a model prompt, adopt a former Session's execution, or automatically replay work after restart.

## Authority and limitations

New native Dream claims atomically store private provenance alongside their exact claim: original Session Created identity, operation, canonical scope, host, PID and instance nonce. Only exact released ownership or a positively observed local `ESRCH` permits destructive recovery. A live/reused PID, foreign host, unknown owner or other process-check failure remains unavailable. Age and lease expiry are not death evidence. Existing historical claims are never assigned invented provenance.

Discard requires one prepared plan whose targets still match their original hashes and whose observations have not been archived by publication. It removes only that exact executable plan and its owner evidence; it never applies the plan or reverses partially published content. Partial publication requires a separately inspected, authorized clear. Clear refuses any running/publishing capture claim because this slice does not establish dead-owner provenance for historical capture leases.

The public preview contains action, scope, generation, an opaque digest, bounded counts and an unavailable reason. It does not expose private paths, lease tokens, model input or process credentials. Files outside the canonical Memory scope are not part of the action. Current and captured permission rules, operator Created identity and Memory mode are checked again at publication. Managed/headless auxiliary work remains unsupported.

## Publication and retry

The complete file inventory and scope lock waits happen outside the short Session mutation lease. The canonical Memory transaction atomically records the exact operator/action/request receipt with discard or clear journals. A clear receipt privately retains its bounded path/hash inventory, including an existing generated index; retry settles only those exact tombstones and never publishes unrelated pending notes. Clear advances generation and clear cutoff, retains content-free admission/import safeguards, and journals hash-guarded tombstones before filesystem deletion.

`result.committed` means a durable domain action receipt exists. It does not by itself prove all filesystem settlement completed. A post-commit settlement failure is `retry_required` with `committed: true`; it must not be represented as cancellation that undid the action. An explicit retry reconciles only the original operator Created identity and original semantic request. Reusing the Session ID cannot authorize the old action. Passive status/restart starts no provider or recovery worker.

Changed external file bytes remain protected by the canonical tombstone hash. A committed clear that cannot settle stays explicit rather than silently deleting replacement content or claiming completion. Exact retry never advances the original action's generation a second time. Discard does not settle unrelated filesystem journals.

## Private implementation checkpoint

Core and Apexo package typechecks passed. The ten-file changed-store, Dream, migration, controller and crash gate passed 82 tests / 525 assertions with the CI-configured 30-second test timeout. After an explicit fixture argument correction, the final exact-target and generated-index cases passed 2 tests / 11 assertions. Actual CLI acceptance passed six checks with zero provider calls: passive missing scope, discard after original Session deletion, stale preview refusal before admission, scope-bound clear, restart/exact retry and fresh hard deny. All owned processes were reaped. These were private implementation results; the subsequent shared integration and packaged acceptance are recorded below.

Real-store checks cover released/unknown/live/foreign ownership, a held capture lease, changed previews, exact retry, replaced operator identity and changed external file bytes after COMMIT. Four child-process checks park only after actual database COMMIT, unlink or durable receipt settlement, then kill/reap the child before reopening the same store. Exact receipt retry preserves a later action's tombstones and pending notes; ordinary recovery subsequently settles them normally.

Verified draft corrections are [BUG276](testing/test-fixtures/native-memory-recovery-capture-contract.md), [BUG277](testing/types/native-memory-recovery-publication-callback.md), [BUG278](testing/persistence/native-memory-recovery-action-targets.md), [BUG279](testing/persistence/native-memory-recovery-generated-index.md), and [BUG281](testing/test-fixtures/native-memory-recovery-note-writer.md). These are distinct causes; repeated diagnostics of one unrepaired case are not recurrence counts.

Historical unreleased claims without trustworthy provenance and unproven orphan capture leases remain explicit recovery gaps. Process-check EPERM/unknown failures use a fail-closed branch but were not injected in these scoped tests. The live-process test verifies that expiry never proves death; it does not claim to force actual operating-system PID reuse. No installed Grok equivalent of Apexo's private action-receipt recovery was asserted. No new installed-runtime comparison was run for this handoff; prior Memory comparisons remain separate evidence. These ownership rules are Apexo implementation guarantees verified by its own tests.

This slice does not close advanced Memory retrieval, batching, managed auxiliary accounting, or all historical migration/recovery work.

## Shared integration checkpoint

The exact 20-file handoff was reviewed and integrated after checking every original/final hash. The shared ten-file Memory gate passes 82 tests/525 assertions with the existing 30-second per-test budget; Core package typechecking passes. Route inventory covers328 scenarios over 300 routes with no missing/extra routes. Both recovery routes pass their scoped Effect HTTP checks, preserving unsupported-backend rejection. These route checks supplement the actual positive lifecycle tests; they do not establish a complete HTTP aggregate.

The first source CLI run exposed a native Location query mistake in the fixture, now recorded under the existing [BUG091](testing/test-fixtures/hooks-native-permission-location.md). After correcting the fixture placement, source CLI passes six checks with zero provider calls, including deleted-original-Session discard, stale preview409, clear, restart/exact retry and fresh denial403. All owned processes were reaped. No product recovery code changed for that fixture repair.

The additive [server-derived retry command](native-memory-retry.md) is now integrated. The shared Dream/recovery service gate passes 24 tests/162 assertions, all 15 scoped Memory Effect HTTP scenarios pass, and source CLI retry passes nine checks with zero provider calls. Core and Apexo types, Client generation and legacy SDK generation pass. Reopened clients can retry the original private request with its operation ID instead of substituting a fresh preview. The native operation UI remains in development; historical unproven claims and advanced Memory scope above remain open.

## Rebuilt Desktop acceptance

Fresh packaged Electron/Node acceptance exposed and repaired [BUG290](testing/runtime/native-memory-recovery-node-file-probe.md): recovery preview used a Bun-only file probe. The portable correction passes the shared 24-test/162-assertion Dream/recovery gate and Core types. After rebuilding, Desktop recovery passes six checks and exact retry passes nine, each with zero provider calls. Both source CLI commands pass again with the same counts. The installed reference independently passes eight Memory observations and supported clear; it does not claim an equivalent private discard-receipt API. Native operation UI remains a separate in-progress deliverable.
