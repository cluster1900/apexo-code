# Native MCP preference schema retained undefined wire fields

- **ID:** BUG-20261015-032.
- **Scope:** Three additive preference metadata properties on the native MCP status contract.
- **Status:** Fixed and verified.
- **Occurrences:** One contract-authoring issue discovered during review and confirmed by a focused test. Three properties are one occurrence.
- **Observed:** Encoding a status with explicit `undefined` preference metadata retained those property names in the encoded object.
- **Expected:** Follow the Schema package contract: absent optional wire properties are omitted, and explicit `false` remains meaningful.
- **Reproduction:** From `packages/apexo`, run `bun test test/v2/mcp-schema.test.ts`. Before correction, the first `Object.hasOwn` assertion receives `true` instead of `false`.
- **Root cause:** The draft used raw `Schema.optional` for new object properties instead of the package's shared `optional` helper. The raw schema preserves an explicitly encoded undefined property.
- **Fix:** Use the shared helper for the three new fields. Do not change existing unrelated status fields or hand-edit generated clients.
- **Verification:** The original focused test failed as described. After the helper correction, the unchanged contract test passed one test / four assertions. Client and legacy SDK regeneration, candidate generated-code reproducibility, all 21 repository typecheck tasks and App/Desktop builds passed. The complete unit gate remains pending.
- **Constraint:** No new recurring rule; this is already required by `packages/schema/AGENTS.md`.
