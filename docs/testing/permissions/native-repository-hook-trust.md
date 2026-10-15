# BUG-20261015-379: Native repository Hook consent and root discovery

Status: **Fixed and verified** (2026-10-15). Administrator-enforced or signed Hook policy remains a separate future scope (`R03`).

## Scope and observed behavior

The native host Hook loader previously accepted only an exact canonical working-directory grant. A Session opened below a repository root could not explicitly authorize that repository's root Hook configuration through the native Hook interface, and the TUI/CLI mini runtime did not route `hooks.trust` through the native V2 endpoint.

Pinned reference source selects the discovered Git root at Session startup and reload, and exposes explicit repository trust and untrust actions. The installed reference's trusted-root comparison additionally ran nested Hook files; that difference is retained rather than presented as identical behavior. The bounded native slice implements explicit repository consent and root discovery across Desktop, CLI mini runtime, and Fullscreen TUI while preserving existing exact-folder grants.

## Expected behavior

The operator can inspect the canonical repository root, explicitly allow or revoke its Hooks from Desktop (`HooksDialog`), Fullscreen TUI (`DialogHooks` / `HooksBrowser`), or CLI mini runtime (`runtime.ts`), and reload a captured Session at the existing safe boundary. Trust never moves the Session or changes filesystem, sandbox, MCP, LSP or plugin permissions. A nested repository remains a separate authority. Revocation blocks new command and HTTP Hook work from captured sources across Sessions; regrant requires fresh capture or explicit reload.

## Root cause and fix

- Added `packages/core/src/hook-project-trust.ts` binding repository grants to canonical root and Git metadata identity (`gitdir` and `commondir` pointer contents) with bounded no-follow reads, descriptor/path/parent verification, `Flock` serialization, and Session incarnation/owner rechecks before publication.
- Updated `packages/core/src/hooks.ts`, `packages/core/src/hook-snapshot-location.ts`, `packages/core/src/hook-dispatch.ts`, and `packages/core/src/hook-network.ts` so captured repository Hook sources carry immutable authority proof and re-verify current host consent before command execution and immediately before HTTPS request dispatch.
- Exposed `/api/session/:sessionID/hooks/trust` (`v2.hooks.trust`) and compatibility `/session/:sessionID/hooks/trust` (`hooks.trust`), regenerated `@apexo/client` and `@apexo/sdk`, and wired Desktop (`packages/app/src/components/hooks-dialog.tsx`), Fullscreen TUI (`packages/tui/src/component/dialog-hooks.tsx` and `hooks-browser.tsx`), and CLI mini runtime (`packages/apexo/src/cli/cmd/run/runtime.ts`) to route native Sessions through `v2.hooks.trust` and compatibility Sessions through `hooks.trust`.

## Verification commands and results

1. **Failing-before negative control**:
   - Restoring pre-fix root discovery in `packages/core/src/hooks.ts` caused `packages/apexo/test/plugin/hook-repository-trust.test.ts` to fail on `explicit repository Hook consent loads root hooks from nested cwd without broadening exact grants` (`Error: Repository root Hook was not discovered`).
2. **Focused unit and TUI tests** (from `packages/apexo`):
   - `bun test --timeout 30000 test/plugin/hook-repository-trust.test.ts` → `13 pass, 0 fail, 39 expect() calls`.
   - `bun test test/cli/hooks-browser.test.tsx` → `3 pass, 0 fail, 19 expect() calls` (verifies repository root trust status rendering and `t` keybinding toggle in `HooksBrowser`).
3. **CLI and rebuilt Desktop backend acceptance probes** (from `packages/apexo`):
   - `bun script/grok-hook-repository-trust.mjs cli` → `7/7` checks passed (`exact-root-legacy-grant-does-not-expand-to-nested-session`, `stale-consent-token-rejected`, `explicit-root-consent-requires-reload-and-preserves-session-location`, `revocation-fences-two-existing-session-snapshots`, `regrant-does-not-revive-old-snapshot-capability`, `nested-repository-boundary-fences-outer-root-hook`, `explicit-repository-consent-survives-owned-backend-restart`).
   - `bun script/grok-hook-repository-trust.mjs desktop` → `7/7` checks passed against the rebuilt Desktop sidecar backend.
4. **Browser and native Electron Desktop UI + locale (`en`/`zh`/`zht`) probes** (from `packages/apexo`):
   - `bun script/grok-hook-repository-trust-ui.mjs browser --locales` → `5/5` checks passed (`passive-root-preview-does-not-grant-or-run-model`, `explicit-user-consent-enables-root-hook`, `visible-revoke-fences-captured-root-hook`, `regrant-requires-explicit-reload`, `zh-and-zht-consent-and-revocation-labels`).
   - `bun script/grok-hook-repository-trust-ui.mjs native --locales` → `5/5` checks passed in a real Electron Desktop window.

No recurring-rule promotion is needed for this feature implementation.
