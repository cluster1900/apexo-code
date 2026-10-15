# Native Memory dialog assertion scope

- **Bug ID:** BUG-20261015-169.
- **Scope:** The native Memory production-browser acceptance script.
- **Observed:** The first browser run reached the correct disabled Memory dialog with no note preview. Its whole-document negative assertion matched the legitimate earlier `memory` tool transcript behind the modal and failed.
- **Expected:** Disabled management must not show cached note content inside its dialog. Previously authorized transcript content is retained.
- **Root cause:** One fixture-authoring episode used the entire document for a dialog-specific confidentiality assertion.
- **Fix:** Scope note-content assertions to the actual Memory browser container. Keep transcript history untouched and continue checking the absence of preview elements.
- **Verification:** The corrected production-browser run passed disabled/enabled/disabled checks in English, Simplified Chinese and Traditional Chinese, followed by stale-hash refusal and confirmed deletion. That run later stopped on a separate child-control expectation (BUG171), so it is not reported as a complete acceptance pass here.
