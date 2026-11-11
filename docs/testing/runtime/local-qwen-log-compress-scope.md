# BUG-20261111-001: Local Qwen log compression rewrote output of non-shell tools

- Scope: `packages/apexo/src/plugin/local-qwen.ts`, the `tool.execute.after` hook (Local Qwen log compression).
- Observed: With Local Qwen enabled, any tool result longer than `logCompressThreshold` (default 4000 characters) was replaced by a small-model summary prompted to keep only failing tests, errors, stack frames and exit status. The hook is triggered for every tool, so a `read` of a long source file returned a summary instead of the file content.
- Expected: Only shell command output is summarized. File reads, searches and other tool results reach the agent verbatim.
- Root cause: The hook had no tool filter. `tool.execute.before` already skips content-bearing tools, but `tool.execute.after` was written and tested for `bash` only.
- Fix: `tool.execute.after` returns early unless the tool is `bash` or `run_shell_command` (`LOG_COMPRESS_TOOLS`).
- Reproduction: In `packages/apexo`, `bun test test/plugin/local-qwen.test.ts`; the lifecycle test now sends a long `read` output through the hook and expects it unchanged.
- Verification: `bun test test/plugin/local-qwen.test.ts` in `packages/apexo`.

## Verification results

- Without the fix (source change stashed): 1/2 pass; the lifecycle test fails because the long `read` output was replaced by the compressed summary.
- With the fix: 2/2 pass; `bun typecheck` in `packages/apexo` passes.
