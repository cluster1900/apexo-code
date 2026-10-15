# Native Memory child-control expectation

- **Bug ID:** BUG-20261015-171.
- **Scope:** The native Memory production-browser acceptance script.
- **Observed:** After eleven successful checks, the fixture waited for a Memory button on an actual Task child. The App displayed its existing subagent-only transcript and return-to-parent guidance; there was no composer or action row.
- **Expected:** Preserve the existing child UI restriction. Native Memory status must independently reject that child without exposing note content.
- **Root cause:** The fixture assumed the ordinary Session's Memory control exists on every Session page.
- **Fix:** Assert the real child transcript, absence of the Memory control, actual status 409, and absence of the saved note path. Do not introduce a new child control or widen authority.
- **Verification:** The next production-browser run passed this restriction as its twelfth check. It later stopped on the unsupported slash-command interaction, which remains separately tracked; no complete-run success is inferred from this partial result.
