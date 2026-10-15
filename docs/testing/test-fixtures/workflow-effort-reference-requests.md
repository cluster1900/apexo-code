# BUG-20261015-071: Workflow Effort Reference Probe Assumed Every Request Had Messages

- **Scope:** Isolated installed-runtime comparison fixture only.
- **Occurrences:** One authoring episode.
- **Status:** Corrected and verified against installed Grok 1.0.52.

The first effort comparison reached a real child request, then its request-filter code threw `TypeError: undefined is not an object` while calling `.includes` on `JSON.stringify(body.messages)`. The installed runtime also sent auxiliary provider requests with a different shape. The fixture must identify child requests without assuming that all captured requests share the chat message shape or counting title generation as child execution.

The corrected filter checks for an actual user message whose content exactly equals the scenario's child marker. Optional message access excludes other request shapes. The fixture continues to record total provider requests separately from child requests and joins its private Grok process during cleanup.

Verification: `bun script/grok-workflow-effort-official.mjs` from `packages/apexo` passed six comparison checks with five child requests in both the isolated draft and integrated checkout. The final shared run recorded 16 total requests including auxiliary work; only the five identified child requests are invariant. The explicit high, case-normalized low, inherited medium, out-of-catalog max, unknown ultra, and unsupported-model cases are reported separately. This verifies the comparison fixture, not Apexo product behavior.
