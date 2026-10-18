# HttpApi auth probe reports status 0 for the first scenario under load

- Bug ID: BUG-20261018-391
- Scope: `packages/apexo/test/server/httpapi-exercise/backend.ts` (`callAuthProbe`), `bun run test:httpapi` auth mode
- Observed: `FAIL GET /global/health global.health — auth expected 401, got 0`. One failure in a CI-equivalent full gate run; 3/3 failures in isolated auth-mode runs while 12 busy loops loaded an 8-core host.
- Expected: the first protected route returns 401 without credentials.
- Root cause: the probe races the request against a 1s hang detector. The web handler builds its layers lazily on the first request, so the first auth scenario (`global.health`) spent its 1s budget on cold initialization and the race returned the synthetic `status: 0` timeout result. Moving runtime/app construction out of the race alone did not help (still failed 2/2 under the same load) because layer construction happens inside the first `request`.
- Fix: the first probe after `disposeApps()` gets a 30s cold-start budget; later probes keep the 1s hang detector.
- Verification: under the same CPU load, auth mode with the old harness failed 3/3; with the fix it passes 5/5 runs (343/343 each). The full `bun run test:httpapi` gate passes in all three modes.
