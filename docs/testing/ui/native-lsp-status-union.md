# BUG-20261014-263: Status summary omitted native LSP states

- Scope: App status indicator and native LSP status presentation.
- Observed: App typechecking rejected the new `failed` and `disabled` states because the shared indicator accepted only compatibility `connected | error` values. The prior predicate would not warn for native failure.
- Expected: Both protocols share an honest summary: connected and intentionally disabled servers are neutral; native failed and compatibility error states produce a nonblocking warning.
- Reproduction: Add native LSP status to the directory synchronization store and run `bun typecheck` from `packages/app`.
- Root cause: The summary utility remained typed against the archived SDK state union while the data source gained a distinct native contract.
- Fix: Use the shared connection-state union and explicitly handle both failure spellings. The status list displays a localized state and supported native operation identifiers.
- Verification: `bun typecheck` from `packages/app` passed. `bun test src/components/status-popover-indicator.test.ts` passed one test and five assertions. Production browser and actual native-window acceptance each passed six checks with en/zh/zht, including passive state and live failure invalidation; screenshots were inspected.
