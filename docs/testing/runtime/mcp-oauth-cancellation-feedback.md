# BUG-20261015-058: Cancelled OAuth Lease Wait Reported Storage Damage

- Status: integrated and verified. Live implementation and both terminal sizes passed.
- Occurrences: one authoring episode.
- Scope: native MCP OAuth operation feedback while waiting for a credential lease.

## Observation and cause

A real local OAuth flow reached the token-exchange phase while another holder owned its credential-store lock. Exact cancellation stopped and joined the flow without exchanging a code, but status combined `phase: cancelled` with `error: storage`. The underlying lease-abort exception was sanitized as a store failure and then used after the flow had already identified explicit cancellation. This would incorrectly suggest repairing credential data.

## Fix and verification

When explicit operation cancellation owns the outcome, report the safe `cancelled` code. Preserve `expired` when the operation deadline caused cancellation. The targeted actual-flow test failed once before correction; the final focused package rerun passed 29 tests and 142 assertions across four implementation files. Cancellation performs no token grant and releases the callback listener. This is a draft product finding, not a shipped regression or a recurring constraint.

Integrated verification on 2026-10-15: Live implementation and both terminal sizes passed. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
