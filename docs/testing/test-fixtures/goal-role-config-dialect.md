# BUG-20261014-252: Role acceptance mixed native agents with legacy configuration

- **Scope:** `script/grok-goal-role-selection.mjs`.
- **Status:** Verified on CLI and Desktop; three independent fixture occurrences recorded.
- **Observed:** The valid role-pair scenario used the current model instead of its
  requested alternate model. The native registry had no configured reviewer agent.
- **Expected:** The shared CLI/Desktop fixture loads the reviewer agent and its
  permissions, then the native Goal selects both valid requested components.
- **Reproduction:** Run `bun script/grok-goal-role-selection.mjs cli` with native
  `agents` entries added to the shared fixture's legacy `provider`/`permission` document.
- **Root cause:** Legacy keys correctly selected the V1 configuration decoder.
  Its schema ignored native-only `agents`, and migration consequently had no
  reviewer to register. This was not a native role-selection failure.
- **Fix:** Use legacy `agent` entries and legacy permission maps consistently in
  this fixture document. Dedicated native graph tests continue using native config.
- **Verification:** Corrected CLI and Desktop acceptance each passed six scenarios
  with 84 provider requests. Existing native focused tests also verify valid
  selection with native `agents` syntax.
  The prior Location-readiness field omission and checkpoint missing config file
  records describe different root causes and are not counted as recurrences here.

## Independent MCP UI fixture occurrence

The new `grok-mcp-ui-fixture.mjs` initially spread legacy `provider`,
`enabled_providers` and `permission` keys into a document containing native
`mcp.servers`. The V1 decoder therefore ignored the native server map; the real
native API returned an empty inventory and the initial connected assertion
failed. This is the same dialect-selection mistake in an independent fixture,
not a failure of MCP connection management.

The helper now writes a pure V2 document, including native providers,
permissions and MCP servers. From `packages/apexo`, both
`bun script/grok-native-mcp-tui.mjs` and
`bun script/grok-native-mcp-tui.mjs --fullscreen` passed seven checks, including
real stdio connection/retry, preservation after failure, recovery and no model
work. This was the second recorded occurrence. The third verified occurrence below now supports a scoped constraint.

## Third independent occurrence: Plan recovery hard-denial fixture

The Plan recovery script parsed the shared fixture's V1 `provider`/`permission` document, then added V2 `permissions` to introduce a new denial before restarting. The explicit approval returned204 instead of the expected403 because V1 migration ignored that native-only field; no real deny had been configured. This was not a Plan permission bypass. The original204 assertion failure is retained as fixture evidence.

The correction updates the actual V1 `permission` map with `plan_exit: "deny"`. `bun run script/grok-plan-native.mjs cli` in `packages/apexo` then passed13 checks with10 provider calls: the recovered approval returned403, remained pending in Plan mode, and made no additional provider call; pending prompt wake and explicit dismissal were also passive. Diagnostic reruns are not additional occurrences.

Constraint: [RULE-20261015-010](../../rules/fixture-config-dialect.md). All three failures selected the V1 decoder through legacy keys and silently lost native-only entries. Missing project config and a pure V2 document rejected by a compatibility route are distinct causes.

## Fourth independent occurrence: MCP attachment picker fixture

The new picker fixture used a legacy top-level `provider` discriminator with native `mcp.servers`. Its effective native MCP inventory was empty. Overriding environment content with the same mixed document did not fix the root cause and is not a second occurrence. The fixture now uses the native top-level `providers` map and `api` provider descriptor consistently, and asserts the effective `local` server is connected before UI actions. Actual mini and fullscreen acceptance each passed four checks including read delivery, template expansion and explicit cancellation. No production codec was changed.
