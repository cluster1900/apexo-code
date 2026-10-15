# BUG-20261014-254: Reference calibration incorrectly expected the configured planner model

- **Scope:** Installed Grok role-pair comparison fixture.
- **Status:** Verified; reference fixture corrected without product changes.
- **Observed:** The valid-pair calibration failed because planning requests used
  the parent model, while skeptic and strategist requests used the alternate model.
- **Expected:** Comparison assertions reflect the pinned and installed behavior;
  Apexo's intentional native adaptation is documented separately.
- **Reproduction:** Run `bun script/grok-goal-role-selection-official.mjs valid`
  with an assertion that every configured role uses the alternate model.
- **Root cause:** The fixture assumed the planner shared the other roles' override
  policy. Pinned revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`,
  `crates/codegen/xai-grok-shell/src/session/acp_session_impl/goal_support.rs`
  lines 1443–1452 explicitly preserves the planner's parent model and harness for
  verbatim-fork prefix-cache reuse. Installed Grok Build 1.0.52 agrees.
- **Fix:** Assert parent-model planning separately from configured skeptic and
  strategist requests. Inspect durable role-decision events for both configured
  roles, including actual resolved models and unknown-toolset/model fallback reasons.
  Apexo continues honoring its planner pair through its own native child Session.
- **Verification:** From `packages/apexo`, the installed-reference script passed
  `valid`, `unknown-agent` and `unknown-model` separately, each with 19 provider
  requests. Valid decisions selected the alternate model; invalid decisions used
  `toolset_unknown` and `model_unknown`. These runs are comparison evidence only.
