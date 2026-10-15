# BUG-20261015-289: Nested Goal fixture expected a nonexistent pause status

- **Scope:** New native nested Task Goal cancellation regression; no product status change.
- **Observed:** The pause endpoint and joined Session wait completed. The actual Goal was `user_paused`, with eight known tokens and `usageIncomplete: true`; the fixture asserted `paused` and failed.
- **Expected:** Use the canonical Goal status vocabulary while retaining the joined cancellation and truthful incomplete-usage assertions.
- **Cause:** The fixture decoded status as an unconstrained string and supplied a remembered generic status literal instead of the existing Goal contract.
- **Correction:** Decode with `Goal.Status` and assert `user_paused`. Do not remap runtime statuses or weaken token/usage/provider-count expectations.
- **Verification:** The corrected final nine-file regression gate passed 29 tests and 321 assertions. The Goal pause retained eight known tokens and incomplete usage, and joined before the late provider response was released. The original failed assertion remains one fixture-authoring episode.
