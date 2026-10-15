# BUG-20261014-245: Focused HTTP exercise used an unsupported selector flag

- **Scope:** Manual MCP route verification command.
- **Observed:** Invoking the HTTP exerciser with `--filter v2.mcp` selected all 280 scenarios instead of four. Its parser accepts `--include`; the unsupported flag was ignored.
- **Expected:** The focused command selects native MCP status and its three control-route scenarios.
- **Reproduction:** From `packages/apexo`, run the exerciser with `--mode effect --filter v2.mcp` and inspect the selected count in its header.
- **Root cause:** The invocation used an assumed selector name without checking the exerciser's actual options.
- **Fix:** Stop the owned unintended run and invoke `bun run script/httpapi-exercise.ts --mode effect --include v2.mcp --fail-on-skip`. No product change or parser behavior change is claimed.
- **Verification:** The corrected run selected four scenarios and passed all four, with zero failures or skips. The interrupted 280-scenario invocation is not complete-gate evidence.
- **Independent occurrences:** One invocation mistake.
