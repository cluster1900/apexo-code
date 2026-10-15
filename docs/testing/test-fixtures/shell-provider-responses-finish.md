# BUG-20261014-202: Shell provider fixture ignored Responses finish overrides

- **Scope:** Shared real CLI/Desktop local-provider fixture.
- **Status:** Verified on CLI and freshly built Desktop; one observed occurrence.
- **Observed:** A summary length-termination scenario unexpectedly completed because
  `finishReason` affected Chat Completions only; the actual request used Responses.
- **Expected:** The requested termination must be represented in the selected wire protocol.
- **Reproduction:** Run `bun script/grok-goal-summary.mjs cli` from `packages/apexo`
  against the initial fixture; the length scenario receives successful summary state.
- **Root cause:** Responses unconditionally emitted `response.completed` and full usage.
- **Fix:** Emit `response.incomplete` with `max_output_tokens` for length termination.
  A missing-receipt option omits the terminal response event entirely. Default behavior
  is unchanged. The actual request bodies are retained by the acceptance fixture.
- **Verification:** Corrected CLI acceptance passed all ten scenarios and 80 provider
  requests, including length failure, missing terminal receipt and normal completion.
  The fresh production Desktop backend passed the same ten scenarios and 80 requests.
  This was a fixture issue, not evidence that native summary validation accepted length output.
