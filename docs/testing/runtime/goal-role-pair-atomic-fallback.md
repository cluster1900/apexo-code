# BUG-20261014-208: Native Goal fallback could mix configured and current role components

- **Scope:** Native Goal planner, strategist and skeptic child selection.
- **Status:** Verified by focused tests, CLI, Desktop and package typechecking.
- **Observed:** `SessionGoalRunner.review` independently chose the requested agent
  and requested model. A missing agent retained a valid requested model with the
  parent agent; an unavailable model retained a valid requested agent with the
  parent model. The receipt claimed fallback while executing a hybrid pair.
- **Expected:** A configured model and agent form one pair. Any failed preflight
  retains both current components before creating a child or making a model request.
- **Reproduction:** Configure an unknown agent with an available alternate model,
  then an available alternate agent with an unknown model. Inspect child model,
  agent and execution receipt through the native lifecycle regression.
- **Root cause:** Component selection and fallback were independent branches.
- **Fix:** Resolve the complete pair once and use the selected pair for child
  creation, resume updates, receipts and evidence permission filtering.
- **Verification:** Eleven focused real Location-graph cases passed within the
  six-file native Goal regression gate (104 tests, 713 assertions). Core and Apexo
  typechecking passed. CLI and Desktop each passed six scenarios with 84 provider
  requests, checking actual pairs, fallback reasons and complete token accounting.
  Installed-reference valid, unknown-agent and unknown-model comparisons each
  passed with 19 requests; they are separate from Apexo verification and explicitly
  account for the reference planner's parent-model exception.
