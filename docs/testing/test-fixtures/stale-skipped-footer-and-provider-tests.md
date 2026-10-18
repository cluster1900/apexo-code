# Stale skipped tests in run footer, provider HttpApi and Instruction

- Bug ID: BUG-20261018-393
- Scope: `packages/apexo/test/cli/run/footer.view.test.tsx`, `test/server/httpapi-provider.test.ts`, `test/session/instruction.test.ts`
- Observed: five footer tests were skipped because "OpenTUI crashes Bun in the full `test/cli/run` directory run"; one provider and one sync HttpApi test were skipped without a reason; remote Instruction fetching was a `test.todo`.
- Findings:
  - The full `bun test test/cli/run` directory now runs without a crash (213 pass, 1 skip, 0 fail).
  - Footer: "leader variant binding", "skill picker inserts an editable bound skill command", "clears the synthetic skills draft" pass unchanged. "custom answer submits through keymap return binding" had a stale expectation: the footer intentionally adds `sessionID` to question replies (`footer.question.tsx`); the expectation now includes it. "recreates the frame across command panel transitions" asserted that a composer `TextareaRenderable` exists while the command panel is open; the panel now replaces the composer by design. The test now asserts the current contract (no textarea while "Commands" is open; after closing, a new composer frame and no `┃`/`█` artifacts) and passes, so all five footer tests run.
  - Provider "returns public v2 provider not found errors" passes and is re-enabled.
  - Sync "returns structured validation errors" still fails (`Expected: false, Received: undefined`); left skipped, cause not investigated.
  - The Instruction todo is implemented against a local `Bun.serve` fixture (found URL included, 404 URL dropped).
- Verification: `bun test test/cli/run` 213/1/0 before the fifth footer rewrite; the rewritten test passes alone; `bun test test/session/instruction.test.ts` 14/0; the provider test passes alone.
