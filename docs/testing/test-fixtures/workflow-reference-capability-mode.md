# BUG-20261015-374: Workflow reference fixture used an unsupported capability mode

- Scope: isolated installed Grok Workflow worktree comparison.
- Observed: the first Workflow run failed before any child provider request. Its terminal event reported that `default` was not a valid capability mode.
- Expected: the comparison uses the reference's real accepted option vocabulary before asserting placement behavior.
- Reproduction: call the Workflow `agent` function with `isolation_worktree: true` and `capability_mode: "default"` on installed Grok 1.0.52.
- Root cause: the fixture assumed `default` was a named mode. The runtime accepts `read-only`, `read-write`, `execute`, or `all`.
- Fix: use `all` for this fixture's intended read/write/shell behavior. No Apexo or reference product behavior changed.
- Verification: the corrected final isolated comparison passed seven checks with four child provider turns and seven total requests. It verifies dirty tracked and untracked inputs, actual isolated shell working directories, unchanged parent files, and the same canonical retained worktree plus child edit after fresh-child resume. Current-turn tool outputs are selected separately from historical outputs. Owned fixture processes are joined during cleanup.
- Independent occurrences: one fixture option-authoring episode; no recurring constraint is promoted. This establishes reference behavior, not native Apexo acceptance.
