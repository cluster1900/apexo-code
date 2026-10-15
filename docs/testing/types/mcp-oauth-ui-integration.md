# BUG-20261015-061: OAuth UI Draft Did Not Match Generated Contracts

- Status: integrated and verified. Generators, all 21 typecheck tasks and both builds passed.
- Occurrences: one initial UI integration episode, not three recurrences.
- Scope: the native MCP authentication component, expiry contract and terminal adapter.

The first private App typecheck reported `Property 'phase' does not exist on type 'true'`: a Solid `Show` condition returned the final boolean operand instead of the flow object consumed by its child. The same run found generated `expiresAt` values could be `number | "-Infinity" | "Infinity" | "NaN"`, incompatible with the intended finite timestamp. The terminal check reported `Cannot find module '@apexo/schema/mcp'` because that package does not declare a direct Schema dependency.

The component now returns its flow object from the condition. Expiry uses the repository's `NonNegativeInt` contract, and the terminal adapter imports the generated authentication type from its existing SDK dependency. No generated file was edited manually and no runtime dependency was added.

Verification: in a private complete source workspace, run `bun run generate` from `packages/client`, then `./packages/sdk/js/script/build.ts` from its root. Both completed successfully. `bun typecheck` from `packages/app` and `packages/tui` then passed, and the private App production build passed. The App retained its vendored Client dependency. Browser and terminal behavioral checks are tracked separately in the feature acceptance notes.

Integrated verification on 2026-10-15: Generators, all 21 typecheck tasks and both builds passed. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
