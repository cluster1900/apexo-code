# BUG-20261014-181: Temporary native Plugins PTY harness resolved unpinned packages

- Scope: the isolated native Plugins terminal acceptance harness; production code is unaffected.
- Observed: the first harness never rendered its panel and timed out. Its terminal trace showed Bun resolving and downloading packages rather than executing the fixture.
- Expected: the harness uses the repository's already installed and pinned OpenTUI/Solid packages without package installation.
- Reproduction: write the TSX harness into a temporary fixture directory outside the repository and run it with JSX transformation enabled but no local dependency-resolution path.
- Root cause: absolute explicit imports did not cover implicit JSX/runtime imports inserted by the transformer. The temporary directory had no node_modules path, so Bun automatic installation attempted to resolve those imports.
- Fix: link the fixture's node_modules to the package's existing dependency directory and disable Bun automatic installation for the child process.
- Verification: the failed process and its native server were reaped. The corrected `bun script/grok-native-plugins-tui.mjs` and `bun script/grok-native-plugins-tui.mjs --fullscreen` commands from `packages/apexo` each passed five native-action checks. Both rendered immediately using pinned dependencies, distinguished enabled from active, applied a supported plugin, retained the active snapshot after unsupported MCP failure, and made zero model calls. Both children and native servers were reaped.
