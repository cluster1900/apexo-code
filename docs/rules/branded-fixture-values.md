# RULE-20261015-003: Preserve Branded Values in Typed Fixtures

- **Status:** Active.
- **Source:** [BUG-20261014-117](../testing/types/location-model-id.md), with three independent typed fixture episodes.
- **Scope:** Tests that admit schema-branded identifiers or paths, or compare branded outputs through typed assertion overloads.
- **MUST:** Construct admitted IDs and paths with the owning schema's canonical constructor. When asserting branded outputs, construct the expected value with the same schema or explicitly compare primitive representations when the assertion only concerns text.
- **NEVER:** Cast away a brand or weaken production schemas to make a fixture compile.
- **Verification:** Run the affected runtime tests and package `bun typecheck` separately. A passing runtime test alone does not prove that a typed fixture satisfies the domain contract.

The independent cases are native model admission/assertion, project directory assertion, and Workflow effort variant assertion. Multiple diagnostics within one fixture authoring episode are not additional occurrences.
