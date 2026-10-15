# Repository Hook trust: integrated and verified (Phase 1)

Status as of 2026-10-15: **Integrated and acceptance-verified across CLI, Fullscreen TUI, and Desktop (`R02`)**. Administrator-enforced and signed policy remains a separate future scope (`R09`).

## Preserved reference artifacts

- `changes.patch`: original portable repository-relative patch from the pre-integration handoff.
- `manifest.json`: baseline and candidate SHA256 manifest from the pre-integration handoff.
- `locales.patch` and `locales-manifest.json`: 62-locale additions for four repository-consent keys (integrated into `packages/app/src/i18n/*`).
- `validation.json`: pre-integration packaging check record.

## Integrated behavior

Explicit host consent enables repository-root Hook configuration for Sessions inside the nearest canonical Git repository. Legacy exact-folder grants retain their exact cwd scope. Selecting a folder or opening the panel is not consent. Session Location, sandbox/filesystem permissions, MCP/LSP and plugin trust remain unchanged.

The storage/proof module (`packages/core/src/hook-project-trust.ts`) binds root and Git metadata identity, including `gitdir`/`commondir` pointer contents. It uses bounded no-follow reads, descriptor and path verification, `Flock`, and atomic store publication. Consent writes use existing Session lifecycle/selection ownership and recheck it after waiting for the store lock. Revocation, stale proof, changed Git boundaries and invalid stores prevent new project command/HTTP work. HTTP authority is checked again after asynchronous preparation immediately before request creation. Regranting does not reactivate an old captured capability; reload is required. Running Hooks retain existing cancellation/join ownership.

Native (`/api/session/:sessionID/hooks/trust`) and compatibility (`/session/:sessionID/hooks/trust`) API actions, the Desktop App consent panel (`packages/app/src/components/hooks-dialog.tsx`), the Fullscreen TUI (`packages/tui/src/component/dialog-hooks.tsx`, `packages/tui/src/component/hooks-browser.tsx`), and the CLI mini runtime (`packages/apexo/src/cli/cmd/run/runtime.ts`) are wired end-to-end. Stored trust and effective allowance remain distinct so a restrictive legacy denial remains visible. New repository consent loads root Hooks only; it does not silently authorize every intermediate directory.

## Authoritative code entrypoints

| Area | Entry |
| --- | --- |
| Proof, store, revision and publication fence | `packages/core/src/hook-project-trust.ts` |
| Discovery and immutable source authority | `packages/core/src/hooks.ts` |
| Session ownership and trust action | `packages/core/src/hook-snapshot-location.ts` |
| Process/network dispatch authority | `packages/core/src/hook-dispatch.ts`, `packages/core/src/hook-network.ts` |
| Captured caller propagation | `packages/core/src/hook-observer.ts`, `packages/core/src/session/hook-stop.ts`, `packages/apexo/src/plugin/bundle-hooks.ts` |
| Public contract | `packages/schema/src/host-hooks.ts`, `packages/protocol/src/groups/hooks.ts` |
| API handlers | `packages/server/src/handlers/hooks.ts`, `packages/apexo/src/server/routes/instance/httpapi/handlers/hooks.ts` |
| User surfaces | `packages/app/src/components/hooks-dialog.tsx`, `packages/tui/src/component/dialog-hooks.tsx`, `packages/tui/src/component/hooks-browser.tsx`, `packages/apexo/src/cli/cmd/run/runtime.ts` |
| Focused unit and TUI tests | `packages/apexo/test/plugin/hook-repository-trust.test.ts`, `packages/apexo/test/cli/hooks-browser.test.tsx` |
| Backend acceptance probe | `packages/apexo/script/grok-hook-repository-trust.mjs` |
| Browser and native Electron UI probe | `packages/apexo/script/grok-hook-repository-trust-ui.mjs` |
| Feature and bug documentation | `docs/repository-hook-trust.md`, `docs/testing/permissions/native-repository-hook-trust.md` (BUG-20261015-379), `docs/testing/runtime/session-usage-zero-step-failed-settlement-and-event-ordering.md` (BUG-20261015-381) |

## Verification summary

- **Failing-before negative control**: Restoring pre-fix root discovery in `packages/core/src/hooks.ts` caused `packages/apexo/test/plugin/hook-repository-trust.test.ts` to fail on `explicit repository Hook consent loads root hooks from nested cwd without broadening exact grants`.
- **Canonical Client & legacy SDK generation**: `bun run generate` and `bun run check:generated` in `packages/client` and `bun ./packages/sdk/js/script/build.ts` passed with zero uncommitted diff.
- **Focused unit & TUI tests**:
  - `bun test --timeout 30000 test/plugin/hook-repository-trust.test.ts` → `13 pass, 0 fail, 39 expect() calls`.
  - `bun test test/cli/hooks-browser.test.tsx` → `3 pass, 0 fail, 19 expect() calls`.
- **CLI & rebuilt Desktop backend probes**:
  - `bun script/grok-hook-repository-trust.mjs cli` → `7/7` checks passed.
  - `bun script/grok-hook-repository-trust.mjs desktop` → `7/7` checks passed.
- **Browser & native Electron Desktop UI + locale (`en`/`zh`/`zht`) probes**:
  - `bun script/grok-hook-repository-trust-ui.mjs browser --locales` → `5/5` checks passed (`providerCalls: 4`).
  - `bun script/grok-hook-repository-trust-ui.mjs native --locales` → `5/5` checks passed in a real Electron Desktop window (`providerCalls: 4`).
- **Live Grok Build (`1.0.52`) side-by-side comparison**:
  - Verified in an isolated git repository (`repo/packages/sub`) across `cli`, `desktop`, and `/Users/hawk_wu/.grok/bin/grok`: untrusted nested cwd runs `0` hooks; after trusting the repository root, nested cwd discovers and executes the root `Stop` hook with matching stdin payload fields (`session_id`, `cwd`, `hook_event_name: "Stop"`).

