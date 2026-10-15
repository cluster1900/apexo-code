# BUG-20261014-209: Native Goal role overrides lacked capability preflight

- **Scope:** Native Goal role model and agent configuration.
- **Status:** Verified by focused tests, CLI, Desktop and package typechecking.
- **Observed:** Native selection checked agent existence and model resolution but
  did not check actual tool registrations, inherited restrictions or the model's
  declared tool support. A role could select a text-only model or an agent unable
  to read and search evidence, with no preflight fallback reason.
- **Expected:** Required native read/grep registrations, effective inherited rules
  and catalog tool support are checked before child creation and provider execution.
- **Reproduction:** Configure a read-denied or grep-denied role agent, a text-only
  role model, or a parent Session denying required inspection. Run the
  focused real Location-graph tests and native lifecycle acceptance.
- **Root cause:** Available model/agent identifiers were treated as sufficient
  evidence of role capability; materialized registrations and capability metadata
  were not consulted.
- **Fix:** Consult the actual native ToolRegistry and Catalog. Intersect
  selected-agent, parent-agent and parent/Session tool availability; preserve agent
  denial precedence. Record the existing agent_incapable or model_unavailable
  fallback while retaining the current pair. Actual tool permission checks remain.
- **Verification:** Eleven focused real Location-graph cases passed within the
  six-file native Goal regression gate (104 tests, 713 assertions). Core and Apexo
  typechecking passed. CLI and Desktop each passed six scenarios with 84 provider
  requests, checking actual pairs, fallback reasons and complete token accounting.
  Installed-reference valid, unknown-agent and unknown-model comparisons each
  passed with 19 requests; they are separate from Apexo verification and explicitly
  account for the reference planner's parent-model exception.
