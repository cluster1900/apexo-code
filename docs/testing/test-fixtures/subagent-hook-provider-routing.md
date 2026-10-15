# BUG-20261015-347: Subagent Hook fixture assumed a tool catalog on the last provider turn

- **Scope:** Native Subagent Hook integration fixture provider routing.
- **Observed:** Continuation and the eight-gate cap passed, but the two-turn budget
  scenario returned a failed Task receipt and no expected second child text.
- **Expected:** The last allowed provider call remains routable even when tools
  are intentionally omitted; the fixture should observe two child calls and one
  normal-completion Hook gate without changing the Task result contract.
- **Root cause:** The fixture used `JSON.stringify(body.tools).includes(...)` to
  identify the parent. The runner intentionally omits tools at the last allowed
  step, so the fixture callback threw on `undefined`, producing a provider error.
  An intermediate assertion incorrectly inferred a failed Task result was the
  expected turn-limit behavior before the request-routing cause was inspected.
- **Fix:** Select Task identity from user-role provider messages, preserving exact
  provider counts and output assertions. Restore the normal completed Task
  expectation after the genuine final provider reply. The same fixture draft also
  corrected its Task cancellation endpoint expectation from 200 to the canonical
  204; no production HTTP response was changed.
- **Reproduction:** From `packages/apexo`, run
  `bun test test/e2e/v2-subagent-hooks.e2e.test.ts` with the original tool-catalog
  classifier. The last-step case fails while the ordinary continuation case passes.
- **Verification:** The corrected eight-scenario Subagent E2E suite passed as part
  of the 27-test, 307-assertion focused gate. Two child provider calls, one Hook
  decision, final text and completed Task receipt are all independently asserted.
  The provider implementation and production turn budget were not changed.
- **Occurrences:** One fixture-authoring episode, including its diagnostic reruns.
  This is distinct from using historical tool arguments as current output evidence;
  it does not increase that recurring rule's historical count.
- **Status:** Integrated; the shared combined Task/Hook/Workflow gate passes 76 tests / 675 assertions across 24 files. Core and Apexo typechecks also pass.
