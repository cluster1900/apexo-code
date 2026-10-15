# BUG-20261015-222: Headless provider failure was classified as unavailable

- **Scope:** Private native headless input-outcome draft; no shared release defect.
- **Observed:** A real local provider HTTP 400 settled the input as failed/unavailable instead of failed/provider_error. The provider was called once and no corrective provider retry occurred.
- **Expected:** The durable input receipt identifies canonical provider failures separately from setup or unsupported-execution failures.
- **Root cause:** The outer runner failure finalizer mapped every non-interruption error to unavailable, including the existing typed LLMError.
- **Correction:** Preserve interruption precedence, classify the canonical LLMError as provider_error, and retain unavailable for other failures. No message-string matching or provider retry is added.
- **Verification:** The new backend gate passed 11 tests / 188 assertions before the final replay refinement, including real provider rejection, turn limit, unknown usage and exact retry. The final feature record contains the frozen gate result.
- **Occurrences:** One observed draft implementation episode.
