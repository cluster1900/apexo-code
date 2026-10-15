# BUG-20261015-355: Resume fixture asserted native usage through legacy summary counters

- **Scope:** Native Workflow resume CLI acceptance fixture; no product change.
- **Observed:** Restart, durable tool history, source identity, saved Agent/model and read-only assertions passed, then the fixture expected 120 tokens from the Session summary and received zero.
- **Expected:** Prove new native provider usage from the native assistant receipt and Workflow's transport accounting, while historical copied usage remains context.
- **Root cause:** The assertion used Session summary counters maintained by legacy PartUpdated/step-finish projection. Native StepEnded projects usage into the canonical assistant message; this fixture had selected the wrong accounting surface.
- **Fix:** Query the resumed transcript in explicit chronological order, assert the latest native assistant has 100 input plus 20 output tokens, and assert the resumed Workflow reports 120 tokens. Preserve the copied history and unchanged-source assertions.
- **Verification:** Pinned Bun 1.3.14, `bun script/grok-workflow-resume.mjs cli` in `packages/apexo`: five checks, three provider calls, exit zero. The source has two turns and the new child has one; its Workflow usage is 120 rather than rebilling source turns. The earlier failing assertion is retained in handoff evidence. One independently authored fixture failure; no recurring constraint is promoted.
