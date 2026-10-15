# Native Goal role-pair preflight

Status: implemented and verified through native focused tests, CLI, Desktop and
package typechecking. Isolated installed-reference comparisons also passed.

A configured planner, strategist or skeptic model/agent pair is selected together
before a native child Session is created or resumed. An unusable pair falls back
to both components of the current Session. The durable execution receipt retains
the requested pair, the actual pair and the existing typed fallback reason.

- Missing configured agent: `agent_unavailable`.
- Required read or grep registration absent after permission filtering: `agent_incapable`.
- Missing, unauthorized, unsupported or text-only requested model: `model_unavailable`.

Preflight uses Apexo's actual native Agent registry, Catalog, model resolver and
ToolRegistry. It makes no model request and executes no tool. It runs while the
native drain holds the Location runtime guard. A short model ID uses the actual
resolved current provider, including a Session that left its model implicit.

Tool availability is the intersection of the selected agent, parent agent and
inherited Session rules. An agent-wide denial remains a veto even if a later
Session rule allows the same action. This is a capability check; it does not grant
access to every path. Resource-specific restrictions still apply when tools run.
Child Session permissions retain the parent's rules; strategist restrictions,
assigned report paths, immutable plans and Goal ownership remain unchanged.

The current pair is an intentional fallback, not a new permission grant. If the
current pair also cannot perform the task, normal execution, permission and
no-progress handling still apply. A provider failure after preflight does not
retry another pair or hide usage. Existing Goal budget, cancellation and receipt
rules apply to every actual child provider turn.

Public schema and generated clients are unchanged. `Goal.RoleExecution` already
represents the requested pair, selected pair and fallback reason. This adaptation
uses Apexo agents and tools; proprietary upstream harness flavors are not imported.

## Verification

- Eleven focused real Location-graph cases passed in `test/session/goal-role-selection.test.ts`,
  including atomic fallback, catalog tool capability, canonical registration
  permissions, parent denials, inherited Session denials and zero provider calls.
- The combined six-file native Goal lifecycle, strategy, cleanup, files and
  closing-summary regression gate passed 104 tests and 713 assertions.
- `bun script/grok-goal-role-selection.mjs cli` and the same command with `desktop`
  each passed six end-to-end cases across planner, strategist and verifier.
  Each case used exactly 14 provider requests and 1,680 tokens: 84 requests per surface.
- Closing-summary CLI regression passed all ten scenarios with 80 provider requests.
- Installed reference: `grok-goal-role-selection-official.mjs valid`, `unknown-agent`
  and `unknown-model` each passed with 19 provider requests. The fixture checks
  actual model requests and durable role-resolution events. These isolated runs
  are comparison evidence, not verification of Apexo.
- Core and Apexo `bun typecheck` both passed.

## Reference comparison and deliberate adaptation

Pinned reference: revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`,
`crates/codegen/xai-grok-shell/src/session/acp_session_impl/goal.rs`,
`resolve_goal_role_override` lines 665–747. The reference validates the role model
and toolset and returns a complete inherited override on preflight failure.
Installed Grok Build 1.0.52 records `toolset_unknown` and `model_unknown` for the
corresponding invalid skeptic and strategist pairs, then completes on the parent
model. Its valid-pair run records the alternate model for both roles.

The reference intentionally ignores the planner override in
`goal_support.rs` lines 1443–1452 and preserves the parent model and harness for a
verbatim-fork prefix-cache optimization. The installed valid-pair calibration
confirmed planning requests on the parent model while skeptic and strategist
requests used the configured alternate model. Apexo honors its configured planner
pair through its own native child Session. It does not import upstream fork or
cache orchestration. The reference fixture explicitly checks this exception;
it does not treat the planner as evidence that a configured pair was applied.
