# BUG-20261015-197: Promise cancellation test published readiness before registration completed

- **Status:** Corrected and integrated; shared package typecheck and the five-file 48-test/169-assertion workspace/cancellation gate passed.
- **Scope:** New `EffectBridge.fromPromise` cancellation regression. One confirmed fixture episode; not a production cancellation defect or recurring rule.
- **Observed:** The test reached its first assertion but timed out at the unchanged five-second deadline while cancelling a pending Promise callback.
- **Expected:** The test cancels only after the callback has installed its abort listener and returned control to Effect's asynchronous cancellation registration.
- **Root cause:** The callback synchronously ran `Deferred.succeed` before installing its listener. That could resume the waiting test inside callback registration, before the abort listener and the enclosing Effect cancellation finalizer were established. The purported readiness signal did not prove cancellation readiness.
- **Fix:** Install the listener first and publish the Deferred from a microtask after callback registration returns. Keep the real Promise pending until its actual abort signal fires. Do not use a delay, increase the deadline or replace cancellation behavior.
- **Verification:** From `packages/apexo`, `bun test test/effect/bridge-abort.test.ts test/server/httpapi-workspace-owner.test.ts` passed two tests/four assertions. The cancellation case verifies the same signal changes from un-aborted to aborted and the actual abort callback settles its Promise.
