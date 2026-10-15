# RULE-20261015-012: Preserve validated values across deferred callbacks

- **Scope:** TypeScript production and fixture code that uses guarded nested or optional properties inside a later callback, including Effect callbacks.
- **MUST:** Capture the validated property in a stable local binding before constructing the callback, or revalidate the current property inside the callback when current-state semantics are required.
- **NEVER:** Assume an outer guard keeps a mutable property narrowed across a callback; do not cast away its union or optionality to suppress the compiler.
- **Verification:** Run the affected package’s `bun typecheck` and actual behavior tests. Preserve the original authority, saved-file identity, error and cancellation assertions. Runtime success alone does not establish type correctness.
- **Source:** [BUG-20261015-117](../testing/types/native-media-webp-fixture-narrowing.md), five independent occurrences: WebP saved-path fixture, native Shell worker notification callback, S3 saved-output fixture, headless output event callback and native socket LSP startup notification callback.

A stable binding must preserve the intended semantics. Do not snapshot a value that is required to be read afresh at execution time; revalidate it at that boundary instead.
