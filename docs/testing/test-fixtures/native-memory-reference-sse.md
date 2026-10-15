# Memory installed-reference fixture omitted the SSE creation timestamp

- **Bug ID:** BUG-20261015-154
- **Status:** Fixture corrected and verified.
- **Scope:** Isolated installed Grok comparison, local chat-completions fixture only.
- **Observed:** The installed runtime returned ACP internal error with `serialization error: missing field created` while decoding the local SSE chunk. No Memory contract assertion completed.
- **Expected:** Serve the actual chat-completion chunk envelope required by the installed provider parser.
- **Cause:** The newly authored local response included id/object/model/choices but omitted the required `created` timestamp. This does not establish a product defect or a Memory-tool mismatch.
- **Fix:** Add a deterministic creation timestamp to each local SSE chunk. Keep the official parser and assertions unchanged.
- **Verification:** The corrected isolated comparison passed two enabled backend-selection cases with four local provider requests. Passive management caused no provider calls. Both children were terminated and joined, and the owned disposable repository was removed by the fixture finalizer. This verifies the fixture envelope; the installed tool catalog difference remains explicitly documented as comparison evidence.

## Shared integration verification

The corrected isolated installed-reference script passed again after shared integration: two enabled configuration comparisons and four local provider requests. Passive listing caused no additional provider work. This does not verify Apexo implementation behavior or claim that the installed runtime exposed legacy Memory tools.
