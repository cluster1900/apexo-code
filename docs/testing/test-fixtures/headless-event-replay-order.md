# BUG-20261015-232: Replay fixture omitted canonical event sequence order

- **Scope:** Private headless replay regression setup.
- **Observed:** The initial real replay fixture failed before its product assertion: expected sequence 1 but received 2 at index 1.
- **Expected:** Replay the saved aggregate events in their authoritative sequence order.
- **Root cause:** A direct EventTable query had no ORDER BY and its SQLite result order did not represent replay order. This is distinct from the public message-list API's documented descending default.
- **Correction:** Query EventTable with ORDER BY seq before replayAll. Keep event IDs, payloads, sequence values and the replay equality assertion unchanged.
- **Verification:** The corrected fixture reached and reproduced BUG-20261015-231. The final combined backend gate passed 39 tests / 301 assertions after that product correction; no event-replay validation was relaxed.
- **Occurrences:** One fixture authoring episode.
