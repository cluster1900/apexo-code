# BUG-20261015-213: Headless admission policy missing from durable projection

- Scope: Private native headless Phase 1 draft; no shared release defect.
- Observed: Initial admission returned its supplied policy, but an exact retry failed with Session.PromptConflictError after one successful assertion.
- Expected: Exact input retry includes the immutable execution policy and returns the same admitted receipt. A changed policy conflicts; historical ordinary inputs remain ordinary.
- Root cause: The draft added policy to the event and response but omitted policy/status from the PromptAdmitted row insertion. The historical Prompted insertion also needed the active-state projection.
- Fix: Persist the policy and admitted status on admission; preserve policy with active/started metadata when lazily projecting an already promoted input. Omitted historical policies retain null execution fields.
- Verification: Actual private Session/Event/SQLite regression passed 1 test / 37 assertions, including exact retry, policy conflict, historical ordinary defaults, actual EventV2 replay, withdrawal and immutable outcomes. Replayed headless inputs retain their policy but never gain a new live execution owner.
