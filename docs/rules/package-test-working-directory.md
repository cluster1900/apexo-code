# RULE-20261014-002: Use Separate Tool Calls and Explicit Working Directories for Package Tests

- **Status**: Active
- **Source**: [BUG-20261014-003](../testing/test-fixtures/test-working-directory.md) (4 independent occurrences mixing working directories across edit and test commands).
- **Scope**: Repository file edits/formatting and package-scoped test or check commands.
- **MUST**: Separate repo-level file edits or formatting from package-level test runs into distinct tool calls. Always set the test call's working directory (`workdir` / `Cwd`) explicitly to the target package directory rather than relying on a prior command's directory.
- **NEVER**: Combine repo-relative file edits with package-scoped `bun test` invocations in a single command. Use absolute paths for file edits or run them in a separate root-scoped call.
- **MUST**: Never run `bun test` directly from the repository root (`do-not-run-tests-from-root`). The CI-mandated `GITHUB_ACTIONS=false bun turbo test --concurrency=2` command from the repo root orchestrates per-package tests and remains valid for full CI verification.
- **Verification**: Confirm the test output includes the target test files and pass counts; hitting the root guard, `FileNotFoundError`, or exit code 1 does not count as a test run.
