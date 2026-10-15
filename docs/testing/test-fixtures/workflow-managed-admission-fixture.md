# Workflow managed-child fixture authoring boundaries

- **Bug ID:** BUG-20261015-085
- **Scope:** New Workflow managed-admission and ownership regression fixtures.
- **Status:** Corrected; runtime checks verified in isolated source validation.
- **Independent authoring episodes:** 1. These setup and expectation corrections are not product failures or a recurring-root-cause claim.

The first expanded admission test supplied partial `SessionV1.Event.Updated.info` containing only ID and metadata. The real event contract requires complete SessionInfo; decoding failed at `slug` before the metadata-removal assertion. The fixture now decodes the original Created payload and publishes that complete information with changed metadata.

The next run reached legitimate Workflow completion, but expected only the raw stage prompt. The canonical engine appends its untrusted args/input block. The fixture now expects the exact complete prompt, including that block, rather than weakening the inbox count or filtering away unrelated input. The provider request also rejects the injection marker.

A package typecheck additionally caught an optional branded Created ID passed as an expected plain string. The assertion now compares the queried optional value with the canonical EventV2.ID constructor. Production schemas were unchanged.

Verification: `bun test test/workflow/managed-admission.test.ts test/workflow/schema-correction.test.ts` passed 6 tests and 52 assertions. The composed seven-file regression passed 8 tests and 150 assertions. Final Core, Apexo and Server package `bun typecheck` each passed. The omitted explicit Goal ID in the separate CLI fixture is the existing BUG-20261015-002 cause; the omitted public Lifecycle service is recorded in BUG-20261014-134, not counted again here.
