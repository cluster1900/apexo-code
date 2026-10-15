# BUG-20261015-255: Unconfirmed remote cleanup returned a signal-success exit

- Status: corrected and integrated; shared compiled cancellation/uncertainty checks pass.
- Scope: native headless attachment signal handling.

A real HTTP proxy returned 503 for the canonical conditional input-interrupt request after SIGTERM. The CLI printed that cleanup was unconfirmed, but its finalizer still returned 143. The server's input remained active and its actual foreground process was alive. Expected behavior is exit 1 with explicit uncertainty, without a fabricated terminal receipt or a claim that the remote owner was joined.

The adapter's finalizer inferred success from signal presence alone. It now records confirmation only after a successful canonical interrupt response; local host disposal independently proves local ownership cleanup. Signal exit 130/143 requires one of those confirmations. An unreachable attached server leaves exit 1. Signal handlers remain installed until owned subscription and local host cleanup finish.

`bun script/grok-native-headless-races.mjs` reproduced 143 versus expected 1 before the correction. Afterward all three real-server cases passed with three provider requests: withdrawal after admission but before wake, an older input settling as superseded while a newer provider remained held, and unconfirmed remote cleanup. The last case proved the remote process remained alive, then explicitly joined it through the fixture's real Session interruption API and verified it was reaped. Confirmed SIGINT/SIGTERM separately return 130/143 in the local and attach acceptance matrices. No physical network-close guarantee or unrelated cancellation defect is inferred.

The ordered BUG-20261015-261 startup amendment further distinguishes local host disposal from durable input confirmation: disposal is always joined, but an unknown admission does not become confirmed solely because the local host closed. The exact input receipt or a proven pre-admission stop remains the signal-exit authority. This is a reviewed extension of the startup boundary, not another occurrence of the original remote503 observation.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
