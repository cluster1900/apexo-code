# BUG-20261014-164: Older prompt retries lost their hook receipt

- Scope: Compatibility Session host-hook execution outcomes across multiple user messages and explicit reload.
- Observed by inspection: The adapter stored only the latest message ID and result per Session. Returning to an older already executed user message after a later turn would dispatch its UserPromptSubmit hooks again; restoring only its identity would also retain the wrong turn's additional context.
- Expected: Every exact message retry retains its original outcome and trusted additional context for the Session lifetime. A new message ID runs the current registry. Reload does not bypass a prior denial or run model work.
- Reproduction: Execute message A, then message B, reload, and retry A. Repeat with a denied A followed by an allowed B. Trace counts must remain unchanged on each retry, and successful A must restore A's context.
- Root cause: A single latest-message cache conflated Session lifetime with the most recent turn.
- Fix: Keep Session/message-ID receipts containing the dispatch promise and per-source prompt context. Restore the corresponding context on success; retain rejected outcomes. Receipts are released with their Session/Location state, without arbitrary eviction that would break exact retries.
- Verification: The direct adapter regressions passed with the Runner/snapshot batch: 34 tests, 104 assertions. They check older successful context restoration and older rejected outcomes after a later successful prompt and another reload. The real CLI and production Desktop backend fixtures each passed all nine snapshot/reload scenarios.
- Occurrences: One code-inspection finding; no recurring constraint promoted.
