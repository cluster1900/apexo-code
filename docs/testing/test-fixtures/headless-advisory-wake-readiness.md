# BUG-20261015-223: Headless notice fixture treated Session wait as prompt completion

- **Scope:** Private ready-Task-notice acceptance after a completed headless input.
- **Observed:** Both later ordinary steer and queue cases asserted three provider calls but observed two after calling Session.wait immediately after prompt admission. A diagnostic run reached the third provider request; that passing run alone was not considered a fix.
- **Expected:** Retain the original completion notice and verify its actual delivery in the next ordinary provider request.
- **Root cause:** Prompt admission schedules an advisory wake. Existing Session.wait snapshots current process-local ownership and can return before the newly scheduled drain starts; it is not a durable per-input completion barrier.
- **Correction:** Wait for the actual third provider request before joining the ordinary drain. Preserve the call count, notice acknowledgement, provider payload and transcript assertions. Headless input completion uses the new passive receipt wait instead.
- **Verification:** Both steer and queue cases passed in the real native 9-test / 124-assertion gate and the later 11-test / 188-assertion HTTP gate. No production wait behavior or timeout was changed.
- **Occurrences:** One authoring episode affecting two cases. This is distinct from provider-name classification and cancellation-before-PID readiness.
