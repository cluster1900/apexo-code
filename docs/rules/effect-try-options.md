# RULE-20261015-023: Use the pinned Effect.try options form

- **Scope:** Synchronous exception conversion in production code and tests using the pinned Effect v4 beta.
- **MUST:** Use `Effect.try({ try: () => operation(), catch: cause => typedFailure(cause) })`, preserving the actual error channel.
- **NEVER:** Use the older `Effect.try(() => operation())` overload; this runtime requires the explicit catch function.
- **Verification:** Run the affected package's `bun typecheck` and an actual success/failure behavior test. An unsupported overload can turn a recoverable parse error into a defect.
- **Source:** [BUG-20261014-006](../testing/types/goal-changes-effect-try.md), three independent episodes: Goal Git UTF-8 decoding, native Memory extraction parsing, and native batch Dream response validation. Repeated diagnostics of one episode do not add occurrences.
