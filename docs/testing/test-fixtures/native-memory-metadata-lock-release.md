# BUG-20261015-305: Held-storage fixture released one lock twice

- Scope: six native metadata lock-wait scenarios in one fixture authoring episode.
- Observed: the behavior assertions completed, but teardown failed with `Refusing to release: lock is compromised (metadata missing).`
- Expected: release the fixture-owned filesystem lease exactly once, including on early test failure.
- Reproduction: acquire Flock directly, register lock.release as a finalizer, manually release it before joining the blocked operation, then end the test scope.
- Root cause: Flock leases are not idempotent; the fixture manually released its lease and then the finalizer tried to release it again.
- Fix: one local idempotent release effect is shared by the intentional unlock and finalizer. Production Flock behavior is unchanged.
- Verification: all six corrected held-storage scenarios passed in the five-file regression gate (61 tests, 365 assertions, zero failures on Bun 1.3.14). The six symptoms are not six independent recurrences.
