# BUG-20261014-109: Snapshot test harness invocation

- Scope: Hooks snapshot service tests.
- Observed: The first focused run failed during module loading with `test is not a function`; no service assertions ran.
- Expected: The package Effect test harness registers and executes both service tests.
- Reproduction: Run `bun test test/plugin/hook-snapshot.test.ts` from `packages/apexo` with the initial fixture calling the object returned by `testEffect`.
- Root cause: `testEffect` returns an object with an `effect` registration method, not a callable function.
- Fix: Register tests through `test.effect`.
- Verification: `bun test test/plugin/hook-snapshot.test.ts`: 3 passed, 18 assertions. Core and Apexo `bun typecheck` both exited 0 after correction. One observed occurrence; no recurring constraint promoted.

## Management fixture corrections

The new control test initially compared an Effect Result to a plain object. Its tag is not an ordinary enumerable own property, so compare the tag and failure fields directly. The next Runner/snapshot batch passed 32 tests and 96 assertions.

The raw HTTP snapshot fixture initially expected an absent `inspection` property for an uncaptured Session. The Effect HTTP encoder emits `null` for that optional field; generated typed clients decode it to the optional form. Aligning the raw-wire assertion made the CLI acceptance pass seven scenarios, including admission without capture and explicit reload without provider work. These are distinct fixture errors, not additional occurrences of the original test registration bug.

The new adapter fixture initially called a nonexistent `SessionID.ascending()` helper. Session IDs use `descending()`; message IDs use `ascending()`. After correction, both adapter regressions passed in the 117-test batch. The typecheck then required a mutable inferred user message shape (rather than the schema decoder's readonly optional fields) and literal `host: true` in a conditionally appended source. Those fixture typing changes are pending the final typecheck.
