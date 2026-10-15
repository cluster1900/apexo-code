# BUG-20261015-092: Temporary DDL comparison truncated an escaped template literal

- **Scope:** Integration-only verification of the generated managed-child migration against its already prepared canonical migration.
- **Status:** Verification helper corrected; equivalent schema verified.
- **Independent occurrences:** Two independent helper-authoring episodes.

The temporary SQL extractor stopped at an escaped backtick followed by a parenthesis inside a TypeScript template literal. SQLite rejected the truncated statement with an unrecognized-token error. The intended check was to execute each complete CREATE TABLE statement independently and compare columns, foreign keys and indexes before removing a redundant newly generated migration.

The corrected extractor recognizes escaped characters, requires exactly one complete statement per file, and compares both schemas in separate in-memory databases with the same parent table. All column, cascade foreign-key and primary-index facts matched. Only then was the redundant newly generated migration removed; the canonical ownership migration was retained. No production schema change was made to satisfy the helper. The normal generator refreshed its registry and `bun run migration --check` from `packages/core` passed.


## Native Shell migration comparison

A later integration helper again used a pattern that did not understand escaped backticks in generated TypeScript. It extracted three statements from the handwritten proposal but zero from the generated file, producing an empty PRAGMA result. That empty result was not accepted as equivalence and did not trigger a schema change. The corrected pattern handles escaped characters and the generator’s optional trailing argument comma, asserts exactly three complete statements in each source, executes them, and compares table columns, cascade foreign keys and both secondary indexes plus the primary index. All actual SQLite schema facts match. Root retained the freshly generated canonical migration; the private proposal was not copied. The normal migration consistency check passed. This second independent extractor episode remains below promotion threshold.
