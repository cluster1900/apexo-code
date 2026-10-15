# BUG-20261015-365: Native plugin LSP workspace activation

- **Status:** Integrated; shared CLI and rebuilt Desktop acceptance pass.
- **Scope:** Native plugin LSP parsing, canonical workspace targets, current invocation permissions, owned activation and pending status.

## Observed and expected behavior

A trusted plugin with `workspaceFolder` or `workspaceOpen` was rejected as unsupported. The fixed reference has an executed initialize/open path, and an isolated installed-runtime fixture demonstrated it. Native Apexo should support that behavior within its own LSP service and permission boundary, without moving the Session or embedding the reference runtime.

The baseline focused file failed both camel-case and snake-case preservation checks with `PluginBundle.Unsupported`: 0 passed, 2 failed. The reference passed five independent checks covering hover, socket connection, initialize root/folder, solution/open and project/open. Socket implementation remains a separate native scope.

## Root cause and fix

PluginBundle explicitly rejected workspace fields, native LSP config omitted them, and the client always initialized the active Location root without workspace-opening notifications. Simply forwarding the new fields would also be unsafe: ordinary LSP startup occurs before a Session's permissions are available.

The candidate adds validated settings and stages override/open servers as pending. Native LspTool supplies current permission checks for canonical root/open targets, including external-directory authorization. The Location guard protects the captured generation while activation is serialized. The service revalidates paths and authority after waits and before process initialization, and uses the existing owned scope for cancellation and teardown. Ordinary language servers keep their existing eager startup/recovery behavior. Deferred servers require current authority for a retry and preserve their finite lifetime restart budget.

Review reproduced a separate race in the first candidate: permission was checked before waiting on the activation semaphore, allowing a queued invocation to start after its Session's permission was revoked. The held-first-activation test failed before the correction (the revoked second invocation succeeded), then passed with zero second-process trace after rechecking inside the semaphore. Retry backoff likewise precedes the final authority check. This is one candidate race reproduction, not a recurring-history claim.

The App displays the existing “Waiting for authorization” label, present in all 62 locale dictionaries. Public client/config/legacy SDK outputs are regenerated canonically; none are edited by hand.

## Verification

Commands run from the relevant package directories with pinned Bun 1.3.14:

- `bun test --timeout 30000 test/v2/lsp-workspace-native.test.ts`: baseline 0 passed / 2 failed; candidate 14 passed / 0 failed / 47 assertions. Cases cover malformed/duplicate aliases, zero-side-effect read/open/external denial, concurrent single activation, exact canonical initialize/open messages, changed paths, no stale passive restart, finite retry budget, interruption cleanup, reload/disable, and queued permission revocation.
- Final LSP regression: `bun test --timeout 30000 test/v2/lsp-workspace-native.test.ts test/v2/lsp-native.test.ts test/v2/lsp-policy-native.test.ts`: 25 passed / 0 failed / 141 assertions. This includes ordinary-server recovery and startup/shutdown regression coverage, plus a one-time workspace approval reused within the same invocation without duplicate prompts.
- Canonical `bun run generate` in Client, `bun script/schemas.ts` at the repository root, and `./packages/sdk/js/script/build.ts`: exit 0. Changed generated outputs are Client `src/generated/types.ts`, SDK `src/v2/gen/types.gen.ts`, and `schemas/config.json`; generated-effect output remained unchanged.
- Core, Apexo, App and TUI package `bun typecheck`: exit 0. The final App wording reuses the already existing, fully translated authorization-wait key; composed App verification remains part of integration.
- `bun script/grok-lsp-workspace-native.mjs cli`: 6 checks / 8 provider calls, exit 0. Denied external access starts no process; allowed initialization sends canonical root/open URIs; passive or denied requests do not restart; fresh authorization restarts; disabling joins all owned processes.
- `bun script/grok-lsp-workspace-official.mjs`: 5 checks / 3 provider calls, exit 0 in the isolated installed reference. This is comparison evidence, not Apexo acceptance.
- Shared source CLI and the unified rebuilt Desktop each pass six checks / eight provider calls; all 21 workspace types and unified builds pass.

Two fixture authoring errors were corrected before accepting the integration results: the fixture initially called nonexistent `locations.provide` instead of `Effect.provide(locations.get(...))`, then used nonexistent PluginStore `manage`/`list` instead of `mutate`/`catalog`. Those failures did not reach the corresponding behavior assertions and are not counted as production failures or additional historical occurrences. Initial Core typechecking also caught a V1 mutable-array mismatch in `workspaceOpen.projects`; the V1 schema now follows its existing mutable-array contract. That failed typecheck is not accepted as validation.

See [the feature and reference audit](../../plugins-workspace-activation.md) for fixed-source entry points and the distinction between working LSP behavior and unproven export/cache-prune guesses.


The first existing-LSP regression run had one obsolete expectation that workspace
settings must remain unsupported (24 passed / 1 failed). Its unsupported-policy
matrix now retains the still-unsupported socket case; the new workspace file
provides positive and authority-failure coverage for both alias spellings. The
corrected three-file regression passed 25/25. The initial CLI URI comparison
failure reused the exact filesystem-alias mistake recorded in
[BUG-20261014-106](../test-fixtures/hooks-environment-canonical-path.md); expected
identity is now canonicalized, with no production path relaxation.
