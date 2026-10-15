# Official Compaction Fixture Assumed Apexo's Request Counts

- **Bug ID:** BUG-20261014-148
- **Scope:** `packages/apexo/script/grok-session-compact-official.mjs`
- **Status:** Verified
- **Independent occurrences:** 1

The first reference fixture asserted that an empty installed Grok Session would
perform zero requests, matching Apexo's intended native contract. Grok 1.0.52
instead sent real compaction prompts over its initialized system context. The
fixture's 115-character summary also fell below the upstream 500-character
minimum, causing three repeated summary attempts before failure.
After that assertion was removed, a fixed one-request seed assumption also
failed because initial title generation is a separate request. These were
incorrect reference-fixture assumptions, not proof of an Apexo regression or a
new recurring product failure.

The fixture now provides a sufficiently detailed summary, labels provider
requests by phase, identifies actual summary prompts, and records the empty
result instead of imposing Apexo's behavior on the reference. It also serves
the initial title's Responses function-call protocol instead of incorrectly
returning Chat Completions events. Turn-summary generation is disabled to keep
the scenario focused; initial title generation is still counted separately.

Verification: from `packages/apexo`, pinned Bun 1.3.14,
`bun run script/grok-session-compact-official.mjs` passed three checks on installed
`grok 1.0.52 (0920c8169e27)`. Five requests were observed: an empty-session summary,
an initial title, a seed assistant reply, a nonempty summary, and the deliberately
failed summary. The only final stderr errors were the intended HTTP 400 and its
`compact_failed` handling. No upstream test was counted as Apexo verification.
