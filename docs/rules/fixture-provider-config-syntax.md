# RULE-20261015-013: Validate the actual provider fixture before execution

- **Scope:** Newly authored or structurally edited JavaScript/TypeScript acceptance fixtures containing nested provider/model configuration.
- **MUST:** Format the actual fixture with repository configuration and verify it was processed. Validate syntax or package types before starting child servers, applications, or provider fixtures.
- **MUST:** For JavaScript scripts, use side-effect-free `node --check` on the actual file. For TypeScript fixtures, run the affected package's `bun typecheck`. An external draft may use the repository-equivalent formatter stdin filepath only when its output is inspected and saved to the intended file.
- **NEVER:** Treat formatter exit status as validation when ignore rules or an external path skipped the target. Do not weaken production configuration codecs or test assertions to work around fixture syntax errors.
- **Verification:** Retain the parser/typecheck failure and corrected validation, then run the intended runtime scenario. A parser failure before startup is a fixture failure, not evidence of a product defect.
- **Source:** [BUG-20261014-082](../testing/test-fixtures/side-question-native-provider-config.md) consolidates five independent missing-brace episodes: side-question, LSP, Task, Memory, and Scheduler. [BUG-20261015-060](../testing/test-fixtures/native-task-e2e-object-formatting.md) remains a backlink for the Task delimiter and retains its unrelated observations.
