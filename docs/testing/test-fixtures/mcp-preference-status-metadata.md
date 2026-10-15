# BUG-20261015-025: Status expectation conflates config and saved choice

- Scope: additive native MCP metadata test update.
- Status: corrected; isolated and live native MCP suites verified.
- Independent occurrences: one fixture-authoring episode, not a product bug.

While updating exact status assertions, the second Location in the staged-retry
isolation test was expected to report configuredEnabled true and no preference.
Its real fixture configuration deliberately disables the server, then explicitly
connects it. The correct status is connected with configuredEnabled false and
preference true.

The first isolated existing-MCP run passed eleven tests and failed this assertion.
The diff showed the false configured default and true saved override. The fix
changes only that expected metadata; it preserves exact object comparison and
the independent runtime-status assertion. It does not weaken validation to ignore
new fields or alter production configuration.

Verification: `bun test test/v2/mcp-native.test.ts` from the isolated Apexo package
passed 12 tests / 97 assertions after correction. This cause is distinct from the
older opt-in status-button visibility fixture mistake.


Live integration verification on 2026-10-15 also passed the combined preference
and existing native MCP suites, 24 tests / 201 assertions.


The updated exact metadata expectations also passed CLI and packaged Desktop
controls (11 scenarios / nine provider requests each) on 2026-10-15.
