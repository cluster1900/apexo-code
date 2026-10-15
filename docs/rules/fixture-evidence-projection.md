# RULE-20261015-016: Select the field that proves a fixture claim

- **Scope:** Provider request classification and output/cancellation assertions in runtime fixtures and installed-reference probes.
- **MUST:** Identify the authoritative field for the claim before searching for a marker: the current user or system update for delivery, assistant text or completed tool output for execution results, and the exact terminal receipt plus joined process evidence for cancellation.
- **NEVER:** Search an entire serialized request, transcript or NDJSON stream to prove a current input or produced output when the same marker can occur in historical user text, raw tool arguments or metadata.
- **MUST:** Decode the actual supported wire representation before selecting that field. Preserve explicit provider counts, ownership and cleanup checks independently of text matching.
- **MUST:** Classify ancillary title/dashboard requests by their actual tool and wire protocol before counting role or conversation requests; a nonempty tool catalog alone is not proof of a conversation turn. Select the current input only after this classification.
- **Verification:** Retain a fixture where the original command contains the marker but never produces it, and assert the intended result through the selected output or input field. Run the affected real provider/CLI comparison and typecheck typed fixtures.
- **Source:** [BUG-20261015-157](../testing/test-fixtures/monitor-provider-projection.md), three independent episodes: native Monitor delivery assertion, installed Scheduler child classification and native headless signal-output assertion.

This constraint does not treat unrelated timeout symptoms or string-versus-array representation mistakes as extra occurrences. Reference-runtime observations remain separate from Apexo implementation acceptance.

Additional source: [BUG-20261014-166](../testing/test-fixtures/official-strategy-title-routing.md), four independent installed-reference title-request classification episodes, including the completed-Task operator comparison. These remain separate from the three output/input projection episodes above.
