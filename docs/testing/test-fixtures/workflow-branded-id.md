# BUG-20261014-101: Scratch tests used invalid branded Workflow IDs

- Scope: New scratch security test fixtures only.
- Observed: Both tests failed during Workflow.ID construction before exercising filesystem behavior.
- Expected: The fixtures use IDs accepted by the production schema and reach the scratch implementation.
- Reproduction: Construct workflow_scratch_security or workflow_scratch_directory with Workflow.ID.make.
- Root cause: The ID suffix permits alphanumeric characters; the fixture added an extra underscore.
- Fix: Use alphanumeric suffixes without changing the production schema.
- Verification: From packages/apexo, `bun test test/workflow/scratch.test.ts` passed two tests and nine assertions, including traversal, linked targets, size limits, and preservation of outside data.
- Occurrences: One fixture authoring error affecting two tests; not two independent recurrences.
