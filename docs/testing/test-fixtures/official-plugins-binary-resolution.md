# Official Plugins Fixture Executable Resolution

- **Bug ID:** BUG-20261014-191
- **Type:** Test fixtures
- **Scope:** `packages/apexo/script/grok-plugins-official.mjs`
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

The comparison failed with `ENOENT` before executing an official lifecycle
operation. It assumed a former installation location for the Grok executable.
An installed reference available on `PATH` should be usable without editing the
script for one machine.

## Reproduction, root cause and fix

Run the fixture on a host whose executable is installed outside the hardcoded
location. The old absolute path prevented process launch. Resolve an explicit
`GROK_BINARY` override first, then `Bun.which("grok")`; fail with a useful setup
message if neither exists. Preserve the fixture's isolated home, configuration,
working directory and credential filtering.

## Verification

From `packages/apexo`, `bun script/grok-plugins-official.mjs` passed all ten
installed Grok 1.0.52 lifecycle comparisons: add source, browse, explicit trust,
install, list, component inventory, disable, enable, uninstall and source removal.
The process exited successfully. This comparison makes no provider calls and
does not establish installed-reference mid-session reload or Apexo execution.
