# BUG-20261015-333: Attachment race fixture bypassed active-work expectations

- Scope: Native MCP attachment connection-race fixture.
- Observed: The draft fixture expected explicit disconnect during a held resource read to succeed, but received `MCP.Failure` with code `busy`.
- Expected: Explicit MCP management respects the active Location guard. An involuntary transport failure is a separate race.
- Root cause: The fixture attempted to induce connection replacement through an operation that correctly refuses active work.
- Fix: Assert the busy result, then terminate the fixture-owned MCP process to exercise an actual in-flight transport failure and assert no prepared bytes return.
- Reproduction: Run `bun test test/v2/session-mcp-attachment.test.ts` from `packages/apexo` with unconditional disconnect.
- Verification: Corrected service suite passes six tests and 31 assertions, including both the busy result and rejected pending preparation.
- Occurrences: One fixture authoring episode. No production guard behavior changed.
