# BUG-20261016-387 — Phase 3 Whole-Agent Sandbox, Custom Profiles, Linux bwrap, and Administrator Hook/Plugin Policy Audit

- **Bug ID**: `BUG-20261016-387`
- **Affected Scope**:
  - `packages/core/src/command-sandbox/paths.ts`
  - `packages/core/src/command-sandbox.ts`
  - `packages/core/src/command-sandbox/policy.ts`
  - `packages/core/src/command-sandbox/seatbelt.ts`
  - `packages/core/src/command-sandbox/linux.ts`
  - `packages/core/src/hooks.ts`
  - `packages/core/src/hook-snapshot-location.ts`
  - `packages/core/src/plugin-store.ts`
  - `packages/apexo/src/plugin/bundle-hooks.ts`
- **Category**: Runtime / Security Boundary / Policy Enforcement (`R07`, `R08`, `R09`)

## Observed and Expected Behavior

1. **Dangling symlink escape in `CommandSandboxPaths.resolveTarget`**:
   - **Observed**: When resolving a non-existent path inside a confined workspace where the final path component is a dangling symbolic link pointing outside the workspace (for example, `workspace/dangling-escape -> ../outside-dangling.txt`), `realpath` failed with `ENOENT` and fell back to `path.join(parentCanonical, path.basename(normalized))` without inspecting `lstat`/`readlink` on the dangling symlink itself. An in-process `write` tool call would then follow the symlink at `open(..., "w")` time and create the file outside the workspace.
   - **Expected**: `CommandSandboxPaths.resolveTarget` must check `lstat(normalized)` when `realpath` returns `ENOENT`, and recursively resolve symbolic link targets via `readlink` so `canonical` reflects the true destination outside the workspace while `lexical` preserves the symlink path inside the workspace.

2. **`CommandSandbox.preflight` validation ordering on unsupported platforms**:
   - **Observed**: When `CommandSandbox.preflight` ran on an unsupported platform (such as simulated `win32`) with an invalid workspace path (such as a symbolic link workspace), returning `unsupported_platform` before `CommandSandboxPaths.resolve` allowed invalid workspace inputs to report `unsupported_platform` instead of `unsafe_path`.
   - **Expected**: `CommandSandboxPaths.resolve` must validate workspace and protected-path invariants before checking platform backend availability, while `off` returns `CommandSandboxPolicy.off` without path or backend checks.

3. **Electron Node.js runtime compatibility for `sandbox.toml` parsing**:
   - **Observed**: `loadSandboxToml` in `packages/core/src/command-sandbox/paths.ts` initially called `Bun.TOML.parse(text)`. While this succeeded in the Bun CLI runtime, the packaged Electron Desktop main process runs on Node.js where `Bun` is undefined, causing custom profiles in `.grok/sandbox.toml` to fail with `Failed to parse sandbox.toml`.
   - **Expected**: Use the portable `parse` function from `toml` (consistent with `hooks.ts` and `plugin-store.ts`) so `sandbox.toml` behaves identically in both CLI (Bun) and Desktop (Electron Node.js).

4. **Marketplace subdirectory `path` entries dropping pinned `sha` in `PluginStore.refresh` and `disable_plugins` array syntax**:
   - **Observed**: In `packages/core/src/plugin-store.ts`, `refresh` preserved `...(ref ? { ref } : {})` when a marketplace catalog item used `source: { url, sha }`, but omitted `ref` when `source` used `{ path, sha }`. Additionally, `loadPolicy` treated top-level or `[plugins]` `disable_plugins` only as a boolean flag (`disable_plugins = true`) and only read string arrays from `disabled_plugins` / `disabled`.
   - **Expected**: Preserve `...(ref ? { ref } : {})` on subdirectory `path` catalog entries so `require_sha` and commit verification work uniformly across `url` and `path` entries, and accept both `disable_plugins = [...]` and `disabled_plugins = [...]` string arrays in `loadPolicy`.

## Reproduction Steps

1. Run adversarial whole-agent sandbox tests in `packages/apexo/test/session/command-sandbox-whole-agent.test.ts` (including dangling symlink write escape, protected `.env` / `.grok/hooks` / `.apexo/sandbox.toml` write attempts, `strict` read isolation, and `webfetch`/`websearch` network denial).
2. Run adversarial Hook and Plugin administrator policy tests in `packages/apexo/test/plugin/hook-admin-policy.test.ts` and `packages/apexo/test/plugin/plugin-admin-policy.test.ts`.
3. Run live CLI and rebuilt Desktop acceptance scripts:
   - `bun script/grok-native-command-sandbox.mjs cli` and `bun script/grok-native-command-sandbox.mjs desktop`
   - `bun script/grok-hook-sources-native.mjs cli` and `bun script/grok-hook-sources-native.mjs desktop`
   - `bun script/grok-plugin-data-native.mjs cli` and `bun script/grok-plugin-data-native.mjs desktop`

## Root Cause and Fix

- **`packages/core/src/command-sandbox/paths.ts`**:
  - Updated `canonicalizeFollowingSymlinks` to inspect `lstat(normalized)` when `realpath(normalized)` throws `ENOENT`, following symbolic links via `readlink` with a recursion cap of `32`.
  - Replaced `Bun.TOML.parse` with `parse` from `toml`.
- **`packages/core/src/command-sandbox.ts`**:
  - Ordered `CommandSandboxPaths.resolve` before platform backend availability in `preflight` so path validation errors (`unsafe_path`, `invalid_policy`) are reported deterministically before `unsupported_platform`.
- **`packages/core/src/plugin-store.ts`**:
  - Preserved `...(ref ? { ref } : {})` for subdirectory `path` catalog entries in `refresh`.
  - Included `doc.disable_plugins`, `doc.disablePlugins`, `pluginsSection.disable_plugins`, and `pluginsSection.disablePlugins` in the `disabledPlugins` string-array extraction loop in `loadPolicy`.

## Verification

- Focused sandbox unit/E2E suites (`packages/apexo`):
  - `bun test test/session/command-sandbox-whole-agent.test.ts test/session/command-sandbox-paths.test.ts test/session/command-sandbox-bash.test.ts test/session/command-sandbox-launcher.test.ts test/session/command-sandbox-store.test.ts test/session/command-sandbox-creation.test.ts test/session/command-sandbox-native-create.test.ts` -> **16 pass, 0 fail, 157 assertions**.
- Focused Hook & Plugin policy suites (`packages/apexo`):
  - `bun test test/plugin/hook-admin-policy.test.ts test/plugin/plugin-admin-policy.test.ts test/plugin/hook-sources.test.ts test/plugin/hook-preferences.test.ts test/plugin/hook-repository-trust.test.ts test/plugin/store.test.ts test/plugin/host-hooks.test.ts` -> **49 pass, 0 fail, 207 assertions**.
- Live CLI + rebuilt Desktop + Grok Build parity acceptance (`packages/apexo`):
  - `bun script/grok-native-command-sandbox.mjs cli` -> **8/8 checks passed, 10 provider calls**.
  - `bun script/grok-native-command-sandbox.mjs desktop` -> **8/8 checks passed, 10 provider calls**.
  - `bun script/grok-command-sandbox-official.mjs` -> **3/3 profiles verified (`workspace`, `read-only`, `audit-deny`), 4 provider calls**.
  - `bun script/grok-hook-sources-native.mjs cli` -> **5/5 checks passed, 7 provider calls**.
  - `bun script/grok-hook-sources-native.mjs desktop` -> **5/5 checks passed, 7 provider calls**.
  - `bun script/grok-plugin-data-native.mjs cli` -> **6/6 checks passed, 7 provider calls**.
  - `bun script/grok-plugin-data-native.mjs desktop` -> **6/6 checks passed, 7 provider calls**.
