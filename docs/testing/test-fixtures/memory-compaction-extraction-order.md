# BUG-20261015-249: Compaction fixture assumed extraction request order

- Status: fixture corrected; strengthened shared source-preservation test passed.
- Scope: native Memory pre-compaction source preservation test.
- Verified occurrences: one fixture episode.

## Observed and expected behavior

The combined integration gate passed 59 tests and failed the Memory compaction test. Its first extraction request contained `SECOND_DURABLE_SOURCE`, while the fixture required `FIRST_DURABLE_SOURCE` at that exact request position. The required behavior is that both retained sources survive real compaction and are each extracted once; their request order is not a public contract.

## Reproduction and cause

Run `bun test test/v2/memory-lifecycle-native.test.ts` from `packages/apexo`. The original assertion indexed `llm.hits[3]` after two ordinary calls and one compaction call. Saved operation receipts are reconciled by creation time and then ID; distinct source receipts can share a millisecond, so their hash-derived IDs can order the second source first. The observed request disproves the fixture's unconditional ordering assumption, without proving loss of the first source.

## Fix

Inspect exactly the two extraction requests after the verified three-call baseline. Require two processed sources and exactly one request containing each source marker. Preserve the real compaction assertion that the first source is absent from current projected history, the two retained queued receipts, and zero extraction during passive reads. Product ordering is unchanged.

## Verification

The strengthened test passed in both subsequent combined runs, proving exactly two extraction requests, one per retained source. The final combined gate passed 60 tests / 449 assertions. The intermediate run independently exposed the finished-operation retry race documented as BUG251; that failure is not attributed to source ordering. This correction is not a product persistence repair.
