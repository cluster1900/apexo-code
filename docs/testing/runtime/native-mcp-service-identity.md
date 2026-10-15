# BUG-20261014-215: Native MCP shared the compatibility service identity

- **Scope:** Core native MCP and compatibility MCP in one Effect/LayerNode graph.
- **Observed:** Migrated chained-workflow and snapshot fixtures reached native bundle activation but failed with `mcp.prepareReload is not a function`. They supplied a compatibility MCP replacement that correctly implemented the compatibility interface.
- **Expected:** Native and compatibility MCP are different services. Replacing or providing one must not replace the other, even when both appear in the same process and Location graph.
- **Reproduction:** Run the chained-workflow fixture with its compatibility MCP replacement, or the real-service replacement regression in `test/v2/mcp-native.test.ts`. The regression constructs the actual compatibility service, supplies it as an explicit compatibility-node replacement, then activates and reloads the native Location runtime.
- **Root cause:** Both services used the exact Context key `@apexo/MCP`. Runtime context lookup and LayerNode replacement identity therefore treated distinct TypeScript service declarations as the same service. This was a product identity collision, not a missing method in the fixture replacement.
- **Fix:** Give native MCP the key `@apexo/v2/MCP`, following the existing native Config, Agent, and Skill namespace convention. Keep the compatibility key and contract unchanged.
- **Verification:** The focused native MCP, real legacy replacement, and Instance shutdown batch passed 10 tests with 48 assertions. Core and Apexo package type checks passed, and native CLI acceptance passed eight checks with seven provider requests. The final rebuilt Electron Desktop acceptance also passed eight checks with seven provider requests. The migrated compatibility fixture batch subsequently passed 264 tests with two existing skips and 1,053 assertions, including the previously failing chained workflows, snapshot race, and Goal child/abort cases. The installed-runtime comparison is unaffected by this internal service-key repair.

This is one observed identity collision across related fixtures, not one recurrence per failing fixture.
