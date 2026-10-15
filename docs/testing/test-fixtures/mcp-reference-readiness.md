# BUG-20261014-213: MCP comparison prompted before installed-runtime readiness

- **Scope:** Isolated Grok installed-runtime MCP comparison fixture; no Apexo product failure.
- **Observed:** The first comparison prompt finished without a real MCP call and failed the assertion that the provider advertised an echo leaf tool. Captured notifications showed MCP initialization completed after that prompt. The provider advertised `search_tool` and `use_tool` instead of direct MCP leaf definitions.
- **Expected:** The fixture waits for the installed runtime's MCP initialization notification and follows its discovery/execution protocol before comparing actual stdio behavior.
- **Reproduction:** Run `bun script/grok-mcp-official.mjs` from `packages/apexo` using the initial fixture, which prompted immediately after ACP Session creation and expected a direct leaf tool.
- **Root cause:** The fixture incorrectly assumed Session creation awaited MCP readiness and that reference tool materialization matched Apexo's direct native registrations. Neither assumption was supported by the observed protocol.
- **Fix:** Wait for the matching Session's MCP-ready notification, call `search_tool`, extract the returned qualified tool name, and invoke `use_tool`. Supply valid Responses events for the reference's ancillary title request.
- **Verification:** The corrected isolated Grok 1.0.52 run passed three checks with four provider requests, including a real stdio call recorded by the server and its result returned to the provider. The fixture does not verify reference mid-session bundle reload. One fixture occurrence.
