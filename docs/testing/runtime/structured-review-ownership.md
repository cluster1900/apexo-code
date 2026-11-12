# Structured review process and execution ownership

## BUG-20261112-020: Startup recovery interrupted a different live process's reviews

- Scope: native review persistence when multiple Apexo processes share one data directory.
- Observed: starting a local CLI process marked another live backend's active review `interrupted`; that backend continued consuming provider work but could no longer save its result.
- Expected: only a provably absent owner can be recovered as interrupted. A live or uncertain owner remains untouched, and no provider work is replayed.
- Reproduction: hold a review in backend A, start backend B and a local `apexo review` with the same isolated data directory, then release A.
- Root cause: review service construction unconditionally rewrote every unfinished row, without persistent process ownership.
- Fix: add one nullable `execution_owner` column to the existing review table and stamp admissions with the existing `SessionInputExecutionOwner` process identity. Recovery reuses its conservative ESRCH-only dead-owner check. Missing/malformed ownership and PID reuse are not treated as proof of death.
- Verification: the native persistence regression proves another live owner survives reconstruction and an actually exited child owner is recovered without sampling. The real multi-process script also passes all three checks: peer server startup and a separate local CLI leave the first active review running, and its completed result is preserved (two total provider calls).

## BUG-20261112-023: Independent review waited behind its busy parent turn

- Scope: native review child admission and the process-local Session coordinator.
- Observed: a review stayed in `capturing` while the parent provider turn was held, even though its frozen target was already available.
- Expected: an independent, owned review child can use the existing coordinator while its parent continues running.
- Reproduction: hold the parent's provider response, start a review and wait for the review result before releasing the parent.
- Root cause: obtaining `CurrentChildren` through the parent's serialized control lane unnecessarily waited for its provider boundary.
- Fix: expose the existing local coordinator's internal child capability through `SessionExecution.children`, guarded by the parent lifecycle claim. The child still uses the same coordinator, native runner, managed-child ownership and targeted interruption; no new orchestration loop is introduced.
- Verification: the native regression completes the review within its eight-second bound while the parent remains active, then releases the parent normally.

## BUG-20261112-021: Admission and failure reporting hid actionable model errors

- Scope: explicit CLI/API model selection and durable review errors.
- Observed: an unknown model was admitted; provider/model failures were replaced with `Review execution failed`.
- Expected: reject an unavailable explicit model before admission and preserve the native runner's safe error explanation for admitted work.
- Reproduction: request `nope/nope`, or return a provider HTTP 400 while a review is running.
- Root cause: admission did not validate explicit model/fallback references, and the outer worker catch discarded all errors except its two local domain classes.
- Fix: check explicit model and fallback references against the Location catalog before writing the review row; the CLI also checks its fetched catalog before creating its temporary parent. Preserve the runner's bounded, already-redacted message in the failed report.
- Verification: native tests assert no row and zero provider calls for an unknown model, and assert HTTP 400 plus its safe provider explanation for an admitted failure. The standalone CLI regression passes two tests / 19 assertions, including unknown-model rejection before provider work.

## Related ownership and history corrections

- Reusing a review ID from another Session now reports a conflict, rather than a misleading missing-Session error; the native admission test asserts `conflict`.
- History now orders by host admission timestamp and ID as a stable tie-breaker. Its ID cursor resolves that row's timestamp within the same parent Session. The regression intentionally supplies IDs in reverse lexical order and checks both pages.
