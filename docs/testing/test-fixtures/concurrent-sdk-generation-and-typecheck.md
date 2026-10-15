# BUG-20261014-242: Full test preparation rewrote SDK files during typechecking

- Scope: local orchestration of repository-wide verification in one checkout.
- Observed: the full typecheck failed in CLI with missing `@apexo/sdk/v2/types`, missing exported SDK types, and downstream unknown/implicit-any diagnostics. Other package checks had passed before the SDK files were replaced.
- Expected: typechecking and source entrypoints read a stable generated SDK tree.
- Reproduction: start `bun turbo typecheck --concurrency=2` and `GITHUB_ACTIONS=false bun turbo test --concurrency=2` concurrently in the same checkout with an uncached SDK build.
- Root cause: the unit-test task depends on package builds, including the legacy SDK generator. Its `clean: true` output removes and recreates the generated directory while the separately scheduled typecheck can read it. The unit log confirms SDK generation overlapped the failing typecheck. These two top-level commands are not independent read-only checks.
- Fix: serialize repository-wide typechecking after the test/build graph completes. Keep independent isolated acceptance runs parallel, but do not overlap generated-source writers with their readers. No generated files are patched by hand and no product implementation change is required.
- Verification: generator source and both command logs establish the race. After the complete unit/build graph finished successfully, the serialized `bun turbo typecheck --concurrency=2` run passed all 21 tasks. This supplements the identified filesystem race; it is not an unexplained passing rerun.
- Independent occurrences: three local orchestration failures: the original whole typecheck, a separate live CLI startup, and shared MCP helper verification during the full unit graph's SDK generation. CI jobs in separate checkouts do not share this filesystem race.

## CLI startup recurrence on 2026-10-15

The first integrated `bun script/grok-workflow-model.mjs cli` attempt started while the coordinated legacy SDK writer was active. The backend exited before readiness with `Cannot find module './gen/types.gen.js'` from `packages/sdk/js/src/v2/client.ts`. No Workflow scenario ran. The CLI source entrypoint imports the same generated SDK tree, so it is a reader subject to the same clean/recreate race as typechecking.

After the generator exited successfully and the coordinator confirmed no generated-source writers remained, the unchanged CLI acceptance passed all five checks with five provider turns. Its process was reaped. Serialize generated-source writers against CLI/backend entrypoint startup as well as typechecks; source-based acceptance is not independent of SDK generation merely because it performs no compilation.

## MCP helper verification recurrence on 2026-10-15

The full unit graph's uncached SDK build removed and recreated generated outputs while the shared MCP helper test imported `src/v2/client.ts`. The test could not resolve `./gen/types.gen.js`; the combined invocation finished with fifteen service/HTTP tests passing and one module-load error. This is not a passing combined run and does not identify a product cancellation defect. The unit log confirms the SDK generator's `output.clean: true` phase overlapped the failed import. After that writer completed, the unchanged helper test passed three tests / 23 assertions. A package-source hash comparison then found no differences from the final pre-gate checkpoint. All 21 typechecks also exited zero, but passing concurrent readers do not make this orchestration safe.

This third independent occurrence promotes [RULE-20261015-018](../../rules/generated-source-verification-order.md). Future same-checkout verification must complete generated-source writers before starting dependent readers, including the hidden SDK build inside an uncached full test graph.
