# RULE-20261015-008: Conditional Effect channel inference

- **Scope:** Effect callbacks returning branches with different success or error channels, especially generic ownership helpers and typed permission/store boundaries.
- **MUST:** Preserve every branch's actual success, error and environment channels. Prefer a generator with yielded validation/failure branches, or state the complete generic return contract when that boundary genuinely needs one.
- **NEVER:** Cast away channel errors, discard a typed failure, or treat downstream `unknown` diagnostics as independent product failures before checking the conditional callback.
- **Verification:** Run the affected package's `bun typecheck`; retain real success/failure/cancellation tests for the boundary. A runtime pass alone does not verify its types.
- **Source:** [BUG-20261015-005](../testing/types/session-lifecycle-generic-effects.md) documents seven independent episodes: Lifecycle ownership, Hook preferences, native media output preflight, Memory fixture channel inference (two sites in one authoring episode), native Dream/migration controller selection, native legacy flush controller selection, and Feedback image snapshot unions.
