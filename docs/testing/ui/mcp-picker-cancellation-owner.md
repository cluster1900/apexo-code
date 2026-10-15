# BUG-20261015-337: Picker cancellation could discard an unconfirmed owner

- Scope: shared SDK attachment-operation helper, App picker and terminal picker.
- Observed during review: UI `finally` cleared its operation even after a cancel endpoint failure; the helper cached a rejected cancellation promise, preventing retry. Aborting the execute observer after a successful cancellation could also surface an AbortError as an attachment error.
- Expected: only a successful explicit cancel response confirms joining the local owner. Failed cancellation remains visible and retryable, and cancelled observers cannot deliver late attachments.
- Reproduction: reserve and execute a held operation, return HTTP 503 to its first cancel request, then allow the second cancel request. Also cancel while the reservation response is held.
- Root cause: UI cleanup confused observer settlement with server ownership cleanup, and cached failure as a permanent cancellation result.
- Fix: retain the operation and pending state on cancel failure, clear the cancellation promise for retry, suppress cancelled observer results/errors, and clear ownership only after successful explicit cancellation. Navigation cleanup reports an unconfirmed cancellation in App instead of claiming success.
- Verification: `bun test test/v2/mcp-attachment-client.test.ts --timeout 30000` from `packages/apexo` exercises held reservation, held execution and failed-cancel retry through real local HTTP. All three tests and 23 assertions passed. Backend pure/mixed HTTP tests independently prove local-owner join and cooperative MCP cleanup.
- Boundary: neither observer interruption nor remote MCP cancellation notification proves remote cleanup acknowledgement. This is one review episode, not a recurring constraint.
