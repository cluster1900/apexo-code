# BUG-20261015-216: Stop capture fixture waited for projected text before stopping

- **Scope:** New native Memory stopped-source regression; no product change for this readiness error.
- **Observed:** The fixture waited for a held response's text in durable Session context and timed out before issuing Stop.
- **Cause:** The streamed Text.Delta is transient; the corresponding durable text completion is not available while that response is held. The fixture was waiting for a later boundary than the race under test.
- **Fix:** Observe the actual canonical Text.Delta notification, then issue Stop and inspect the settled durable source afterward. The separate runtime-versus-wire listener decoder correction is recorded in BUG-20261015-079, not counted again here.
- **Verification:** The unchanged Stop/source assertions passed one test / seven assertions after readiness correction: incomplete transcript is initially ineligible, Stop preserves a settled source without starting auxiliary inference, and explicit flush extracts it. The later complete lifecycle gate also passed. No timeout was increased to establish the fix.

## Independent Workflow cancelled-source fixture occurrence

The new Workflow resume fixture expected text emitted by a held provider stream in the source's durable transcript after cancelling that stream. The assertion received the durable source prompt and interrupted assistant state, without the transient text. The corrected fixture completes a real read-tool turn before holding and cancelling the following provider turn. It asserts the durable read result in the resumed provider input, the new prompt and unchanged source/Task ownership. Both resume end-to-end tests passed. This is a second independently authored transient-versus-durable evidence error; the product never promised to turn an unfinished Text.Delta into completed history.
