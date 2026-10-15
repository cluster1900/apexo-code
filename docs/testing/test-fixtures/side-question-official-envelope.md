# BUG-20261014-085: Official ACP comparisons omitted the extension result envelope

- Scope: installed Grok side-question and MCP controls reference fixtures.
- Verified independent occurrences: two. The MCP controls occurrence was initially recorded as BUG-20261014-216 and is consolidated here; it is not an additional third occurrence.
- Observed: the fixture read an undefined top-level `answer` after a successful extension request.
- Expected: unwrap the ACP extension result envelope before inspecting the answer.
- Reproduction: run `bun script/grok-side-question-official.mjs` in `packages/apexo` with the installed reference executable.
- Root cause: treating the extension reply as a bare payload, unlike the existing memory reference fixtures.
- Fix: use `response.result ?? response` for both text and image replies.
- Verification: installed-runtime comparison passed all three checks, including text and image replies. This did not affect Apexo product execution.

## MCP controls recurrence (formerly BUG-20261014-216)

The initial `bun script/grok-mcp-controls-official.mjs` comparison failed before
any toggle because it read `servers.some` on the outer extension response. Grok's
`to_ext_response` wraps the payload in `result`; the fixture repeated the same
bare-payload assumption as the earlier side-question fixture.

Unwrapping `response.result ?? response` for list and toggle replies corrected
the fixture. Runtime initialization notification remains a separate prerequisite.
The corrected isolated Grok 1.0.52 comparison passed five checks with four provider
requests: disable and enable preferences survived separate process restarts,
re-enable connected without provider work, and the real stdio tool executed.
This remains a reference-fixture defect, not an Apexo runtime failure.

There are two independent occurrences. No recurring constraint is promoted yet.
