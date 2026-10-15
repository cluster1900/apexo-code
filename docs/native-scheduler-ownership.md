# Durable Scheduler Session Ownership

A saved resume timer records its owner's durable Session Created event identity. Recovery and every fire validate that identity before executing. Deleting a Session removes its saved timers. A stale saved record cannot attach to a newly created Session that happens to reuse the same ID.

For legacy records without a creation stamp, recovery requires the current Session's completed `scheduler_create` receipt to match both the saved task ID and original message ID. A matching receipt permits a durable upgrade. Unknown historical ownership remains saved and inactive, with a recovery error explaining that ownership could not be verified. This preserves uncertain records without authorizing model execution. The caller must resolve the historical ownership problem; normal reads and repeated restarts do not infer ownership from age or ID equality.

The application supplies this ownership adapter to its Apexo Scheduler. Model work runs outside mutation leases. The standalone generic Scheduler can still be used without an application Session adapter.

## Runtime acceptance

From `packages/apexo`:

- `bun script/grok-scheduler-owner.mjs cli`: six checks passed.
- `bun script/grok-scheduler-owner.mjs desktop`: the same six checks passed using the coordinated packaged Desktop backend.

Both runs used actual Session APIs, provider-driven scheduler tools, completed creation receipts, the real saved store, and process restarts. Exactly two scheduled executions reached the local provider in each run: one current-owner timer and one legacy timer backed by an exact completed receipt. Neither the stale-owner timer nor unknown-owner timer executed. Valid one-shot records disappeared after completion and did not execute again after another restart. The unknown record remained unchanged and inactive with the same explicit recovery failure.

The fixture first verifies that real deletion removes the old timer. To exercise defensive recovery, it then restores the captured old record while the backend is stopped. It also accelerates saved deadlines, removes the stamp from the exact-receipt record, and constructs an unmatched legacy saved record through the real SchedulerStore API. These are explicitly labeled synthetic old-store variants, not captured historical installations. The fixture never directly changes Session database rows. Core store imports run only in a short-lived child process with the fixture's isolated environment.

The Desktop result verifies the packaged backend, not visual UI behavior. These checks verify Apexo's ownership format and migration rules; an installed reference cannot establish correctness of Apexo-specific persisted state. The initial mistaken fixture teardown expectation and its correction are recorded in [BUG-20261015-020](testing/test-fixtures/scheduler-owner-teardown-expectation.md).
