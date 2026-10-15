# Native Memory scope-navigation automation did not return a result

- **Bug ID:** BUG-20261015-182.
- **Status:** Investigating; no confirmed product defect or root cause.
- **Scope:** Private production-browser verification of a server-scope change retaining the same Session ID.
- **Observed:** Six checks completed, including a held enabled-status response released after disable and a held preview released after disable. The following actual server-route navigation command failed with agent-browser `Resource temporarily unavailable (os error 35)`: the daemon received the command but returned no response. Body-text and screenshot diagnostics also did not return within their command deadlines. The fixture's browser close succeeded and all owned fixture processes were reaped.
- **Expected:** The navigation action returns a usable result so the fixture can verify whether the Memory dialog closes on scope change.
- **Root cause:** Unknown. The action may have run; it was not retried within the failed fixture. This observation does not prove retained Memory content, a renderer defect, or host-load causality.
- **Follow-up:** Review independently identified that the dialog's active predicate compared only Session ID. A narrow SDK-scope lifetime guard was added as review mitigation, not claimed as the repair for this automation failure. Final runtime results are recorded in the feature report; a successful rerun cannot establish the original cause.

A follow-up run with the first SDK-identity guard reached the same automation symptom. Source review then found a fixture prerequisite: the App resolves a target server connection from its saved server list, but the probe had not registered its second real proxy server. The fixture now registers both actual endpoints before navigating. This setup correction does not, by itself, prove the daemon failure cause. The guard also covers disposal of the creating component, because server changes own a keyed subtree remount.

The final registered-endpoint production-browser run passed eighteen checks, including actual same-ID navigation closing the Memory dialog. This establishes the final scoped behavior, not the original daemon failure cause. No stale-status or retained-content product defect was confirmed.

The rebuilt private native-window matrix also passed all eighteen checks. This does not change the unresolved classification of the earlier browser automation error.
