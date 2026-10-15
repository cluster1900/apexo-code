# BUG-20261015-205: Captured Goal fixture context was attached outside the queued action

- Status: Corrected and verified in the private Scheduler draft.
- Scope: Scheduler captured-Goal denial fixture through native SessionExecution.control.
- Occurrences: One fixture authoring episode; no production guard bypass was established.
- Observed: The added test expected a failure but received successful timer binding. No child or provider request was created.
- Expected: A Scheduler operation carrying a captured Goal attempt must be denied even after the durable Goal is paused; ordinary paused-Goal scheduling remains allowed.
- Root cause: The fixture provided `SessionGoalUsage.Current` around the call that enqueues and waits for a coordinator control. The coordinator executes the queued action using its own owned runtime, so that outer caller-only reference did not accompany the action.
- Fix: Provide the captured reference directly to the queued operation, inside `Execution.control`. Keep the production coordinator and Scheduler guard unchanged.
- Verification: The corrected Scheduler plus Task regression gate passed 18 tests / 280 assertions across nine files. The actual operation rejects the captured attempt with no schedule, Task or provider mutation, then the same ordinary paused-Goal Session successfully uses canonical Scheduler tools and a real child. Permission-denied creation also leaves no schedule or Task. The later orphan-read additions are recorded separately in the feature acceptance counts.
