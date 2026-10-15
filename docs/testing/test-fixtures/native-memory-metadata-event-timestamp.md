# BUG-20261015-303: Synthetic metadata fixture omitted its typed event timestamp

- Scope: native legacy metadata checkpoint fixture.
- Observed: the synthetic-user exclusion test failed before its assertions because SessionEvent.Synthetic requires a timestamp. A numeric timestamp then failed the type-side DateTime contract.
- Expected: the fixture publishes a valid canonical event and tests synthetic exclusion without changing production schemas.
- Reproduction: publish SessionEvent.Synthetic with only Session ID, message ID and text, or with a raw millisecond number instead of the decoded DateTime value.
- Root cause: the new fixture did not use the event's full type-side schema.
- Fix: supply DateTime.nowUnsafe() at the event publication boundary.
- Verification: the corrected activity metadata scenario passed in a focused diagnostic run, including real-prompt gating and repeated checkpoint assertions. Final complete B0 verification is recorded in the feature document.
