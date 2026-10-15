# BUG-20261015-123: QuestionDock ignored explicit custom:false

- **Scope:** Existing App QuestionDock contract, exposed by native Plan approval.
- **Observed:** The real native Question request carried `custom:false`, but the unchanged production browser rendered a custom-answer control. The regression failed with one control instead of zero.
- **Expected:** Explicit false suppresses custom-answer interaction and keyboard navigation. Omission retains the documented default true behavior for ordinary questions.
- **Cause:** The renderer always appended the custom control and included it in focus bounds, independently of the Info.custom field.
- **Fix:** Honor the generic explicit field in rendering, keyboard option count, custom-open/toggle guards and submission filtering. Keep absent/default behavior. Plan purpose remains presentation-only; it is not used as a substitute for the generic field or as authorization.
- **Verification:** The first repaired production browser passed 5 checks/4 provider calls in en/zh/zht, including two-choice navigation and a translated label submitting canonical Approve. App typechecking and production build passed. The extended browser run passed 6 checks/6 calls: an ordinary default question exposed the custom control, Home/End navigation remained bounded, and typed custom text reached the real reply endpoint unchanged before one provider continuation. Exact Plan text and long-document keyboard scrolling also passed.
- **Reproduction:** Run `bun run script/grok-native-plan-ui.mjs browser --custom-probe` with the pre-edit production App artifact and real native fixture. The original failing screenshot and request prove the contract mismatch; no fabricated DOM request is used.
- **Occurrences:** One verified UI contract failure. A later fixture readiness correction is recorded separately under the existing rendered-readiness record.
