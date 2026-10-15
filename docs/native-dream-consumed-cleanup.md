# Native Dream consumed-source cleanup

Successful native legacy Dream now settles consumed-source deletion through its existing durable publication owner. It uses Apexo's canonical manual/automatic executor, maintenance generation, source and destination leases, current/captured permissions, and explicit recovery receipts. No compatibility executor, independent cleanup worker or periodic sweep is added.

## Deletion contract

Only documents actually included in an accepted Dream response are candidates. The exact memory and journal bytes must publish successfully before deletion. Each candidate must still be a regular non-symlink file in the original sessions directory, have the same signature and content as the consumed snapshot, and be at least 300 seconds old at the receipt's recorded cutoff. Current-Session files and documents omitted by the input cap never enter this candidate list. NO_REPLY, invalid output and failed provider work do not delete sources.

A source lease is attempted without waiting before entering the short input-admission fence. Busy, missing, changed, recent, redirected or inaccessible files are retained. A failed deletion does not turn successful consolidation into another provider request. Canonical Memory writers acquire the same maintenance lease before source leases. Current Agent, read/edit/external-directory authority, mode revision, Session Created identity and automatic epoch remain checked after storage lease acquisition. New prompt admission and the final publication/delete pass retain their existing ordering.

New internal publication receipts carry cleanup version 1 and the frozen cutoff. Historical receipts lacking that metadata retain their earlier source-retention behavior. An explicit original-receipt retry may settle missing deletions after a proven dead owner, only while the recorded destination and journal bytes still prove the same publication. Passive restart, opening controls and exact operation-ID retry do not perform cleanup or replay inference. Recreated sources and foreign destination bytes are protected. A source retained as recent does not become eligible merely because an old receipt is retried much later.

The live Memory catalog enumerates current files. Existing legacy search refreshes before each query and transactionally removes missing source paths from its document, chunk and ranking tables; the warmed-index regression confirms deleted sources disappear from search and the catalog. No semantic/vector subsystem is introduced or claimed.

## Verification

- Before feature: the real native focused expectation failed because a successful Dream retained its old consumed source (zero pass / one fail / three assertions). This was an absent capability, not a newly invented bug.
- Final focused gate: 56 tests / 262 assertions pass across cleanup, manual legacy, automatic legacy, native V2 and storage Dream tests. The cleanup cases prove exact old deletion, recent/current/capped retention, warmed search/catalog removal, NO_REPLY, invalid output, busy source, changed source, symlink replacement, late Agent/mode changes and historical-receipt retention.
- Real CLI crash control: the process is killed after actual memory and journal atomic writes but before source deletion. Passive reopening retains the source; explicit original-receipt retry removes the exact old source with one total provider request. Separate real crash runs retain a recreated source and refuse cleanup after a foreign destination edit, also without provider replay.
- Browser composer acceptance: four checks / three provider requests. Opening `/dream` is passive; a real composer turn produces a visible automatic result and removes its old consumed source; a later periodic result removes only its later consumed source. No manual Dream request is issued. Native Electron window acceptance also passes four checks / three requests with both completed receipts visually inspected and actual file deletion asserted. Its unchanged renderer/window shell was reused after comparing 2143 App/UI source files, while the fixture ran the final native CLI backend. Final Core and Apexo package typechecks pass. The integrator's combined rebuilt Desktop backend acceptance remains pending at this checkpoint.
- [BUG367](testing/test-fixtures/native-dream-disable-receipt-expectation.md) records fixture-only receipt expectation mistakes. They required no production fix.

Run focused verification from `packages/apexo` with pinned Bun 1.3.14:

```sh
bun test test/v2/memory-dream-cleanup-native.test.ts test/v2/memory-legacy-dream-native.test.ts test/v2/memory-automatic-dream-native.test.ts test/v2/memory-dream-native.test.ts test/tool/memory-dream.test.ts
bun script/grok-memory-dream-cleanup-native.mjs cli --crash=state
bun script/grok-memory-dream-cleanup-native.mjs cli --crash=state --recreated
bun script/grok-memory-dream-cleanup-native.mjs cli --crash=state --foreign
```

## Reference and boundaries

Pinned Grok source `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, `crates/codegen/xai-grok-shell/src/session/acp_session_impl/memory_dream.rs:427–475`, performs cleanup after successful memory publication and reindexing, then commits the consolidation marker. `crates/codegen/xai-grok-memory/src/dream.rs:283–333` defines the 300-second guard and nonfatal deletion failures. Only actually-read stems are deleted; NO_REPLY and failures retain sources.

Apexo preserves its stronger exact-signature/content checks and durable journal-before-cleanup ordering. Its cutoff is fixed by the original receipt and source lease contention preserves the file. These deliberate ownership boundaries are not claimed byte-for-byte identical to the reference. Installed Grok 1.0.52 (`0920c8169e27`) requested legacy in the isolated probe but exposed effective V2 artifacts; home-denial/exact-port controls passed and provider calls remained zero. This supports isolation/passive behavior, not effective installed legacy cleanup. Whole-batch Dream and semantic/vector retrieval remain separate capabilities.

## Shared integration acceptance

All 11 handoff files are integrated with runtime hashes verified and prior shared documentation retained. The shared cleanup/manual/automatic/V2/storage plus LSP-policy gate passes 62 tests / 311 assertions. Source CLI and the unified rebuilt Desktop backend each pass four checks / one provider call. Shared all 21 types, App/Desktop builds and canonical Client consistency pass. The real native window with the rebuilt shared renderer and source backend passes four checks / three calls; the screenshot visibly shows both Finished receipts and the fixture verifies actual source deletion. Private crash controls remain separately identified above. Linux and the refreshed full repository aggregate are still pending.
