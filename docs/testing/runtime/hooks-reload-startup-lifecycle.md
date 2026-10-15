# BUG-20261014-153: Reload restarted compatibility Session startup hooks

- Scope: Compatibility Session host-hook adapter generation changes.
- Observed by code inspection: Replacing a snapshot rebuilt each bundle adapter with an empty SessionStart cache. The next user prompt would run startup hooks again and discard the previously admitted startup/prompt context.
- Expected: Explicit reload changes the effective registry without restarting the Session. Retain startup context for existing sources, do not emit startup for a newly added source, and preserve prompt admission outcomes and retry identity.
- Reproduction: Capture a Session containing SessionStart and UserPromptSubmit command traces, execute one prompt, edit the registry and reload, then submit another prompt. The startup trace must occur only once for that Session.
- Root cause: Lifecycle and contextual state were stored inside each generation's adapter closures instead of the Session-owned adapter entry.
- Fix: Preserve per-source startup/prompt state across generations and track the Session's startup boundary separately. Existing prompt result receipts remain Session-owned, so a denied prompt cannot be retried successfully merely by reloading configuration.
- Reference: Pinned Grok `hooks_plugins.rs` reload implementation swaps the registry and reports inspection; it does not emit SessionStart. This is behavioral comparison, not Apexo verification.
- Verification: The direct adapter/Runner/snapshot batch passed 34 tests and 104 assertions. The real CLI snapshot fixture passed nine scenarios, including unchanged SessionStart trace counts across idle and active reload. The production Desktop backend passed the same nine scenarios after the common build.
- Occurrences: One code-inspection finding; no recurring constraint promoted.
