# BUG-20261015-367: Manual Dream disable fixture expected automatic cancellation status

- Scope: consumed-source cleanup test fixture, explicit native legacy Dream receipt assertion.
- Observed: the expanded cleanup fixture had seven passing cases and one failure: late mode disable returned `failed`, while the new test expected `cancelled`.
- Expected: an explicit manual operation that reaches current mode validation after disable records `failed`; the source remains intact and no output is published. Automatic epoch cancellation has a separate cancellation contract.
- Root cause: the fixture reused an automatic-work terminal-state assumption for the manual operation path. The existing manual legacy Dream disable test already asserted `failed`.
- Fix: correct only the manual receipt assertion. No runtime behavior changed for this failure.
- Reproduction: hold a real manual Dream provider response, disable Memory, release the response, then read the terminal operation receipt.
- Verification: the corrected cleanup/manual/automatic/storage focused run passed 42 tests / 171 assertions with pinned Bun 1.3.14 from `packages/apexo`. Command: `bun test test/v2/memory-dream-cleanup-native.test.ts test/v2/memory-legacy-dream-native.test.ts test/v2/memory-automatic-dream-native.test.ts test/tool/memory-dream.test.ts`.
- Independent occurrences: one fixture assertion episode; no recurring constraint promoted.

A later expansion added an invalid-output case but initially left it out of the fixture's failure-status branch. That run had 55 passing cases and one assertion failure (`completed` expected, correctly `failed` received). Adding the missing negative-case branch corrects test construction only. This related authoring note is not another occurrence of the manual-versus-automatic contract mistake or a product failure.

The final corrected five-file cleanup/manual/automatic/V2/storage gate passes 56 tests / 262 assertions.
