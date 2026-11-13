# F04 document conformance audit

Current branch re-audit: [f04-mcp-forms-audit.md](f04-mcp-forms-audit.md) (`mcp-forms`, `f26259af`).

## Audit repair status (2026-11-13)

The three findings below are retained as the original audit evidence. The repair adds authoritative descendant discovery to the existing pending-list endpoint and routes all four UI surfaces through the shared Client watcher. It also uses one own-key draft reader for submission and rendering, including first-edit reactivity for fields without defaults.

Additional acceptance now covers sessionless HTTP without an MCP session header, stateless stdio, an old generation's late SDK form while its successor is pending, initialization/idle rejection, a backend restart with a cached frontend request, and a Task in another worktree. The original audit verdict applies to the pre-repair commit. The three findings are fixed, and the added acceptance, all five local gates, production builds and four real UI surfaces have passed. Current verification is tracked in [the implementation checkpoint](f04-implementation.md). The PR remains a draft for human review and has not been merged.

## Original audit (pre-repair)

Date: 2026-11-13. Reviewed commit: `9add09e1921728afb2c49de6ebbfc53935ebb65d` on `mcp-forms`, draft [PR #207](https://github.com/cluster1900/apexo-code/pull/207).

**Conclusion: F04's primary implementation is present, but it is not fully complete against the development plan. Three functional defects were reproduced. Keep the PR unmerged until these defects and the remaining acceptance evidence are addressed.** The earlier completion statement was too broad.

This review compares section 5 and E01–E09 of [the approved plan](codex-first-batch-plan.md) with production code, checked-in fixtures and isolated probes. It does not treat a green CI run or the implementation checkpoint as proof of every acceptance scenario.

## Confirmed functional defects

### F04-A01 — P1: Native mini TUI does not surface forms from an ordinary child Session

- Requirement: Section 5.4 requires interactive native work to show a typed dock and wait for an operator. E08 explicitly preserves ordinary interactive child eligibility; E09 requires the mini surface to handle those forms.
- Observed: With one ordinary foreground Task child, the backend admitted a live MCP form for that child. After two later hydration cycles, the mini terminal still displayed no form. The terminal requested the root's pending list but never the child's list. The operator cannot answer, decline or cancel that form through the root mini interface; the parent Task remains waiting until an external reply or timeout.
- Reproduction: Configure a permitted `worker` subagent, attach to the native root Session with `--mini --no-replay`, have the root invoke `task`, and have the child invoke the real `collect` MCP fixture. Query the child's pending endpoint to confirm the live request. Observe subsequent root hydration cycles and the terminal screen.
- Evidence: `rootQueried=true`, `childQueried=false`, `formVisible=false`. An explicit API decline was used to settle the owned request after observation.
- Cause: [runtime.ts](../../packages/apexo/src/cli/cmd/run/runtime.ts#L459) supplies only the root ID. [footer.view.tsx](../../packages/apexo/src/cli/cmd/run/footer.view.tsx#L174) gets additional IDs exclusively from the footer's subagent tabs. The native transport selected at [stream.transport.ts](../../packages/apexo/src/cli/cmd/run/stream.transport.ts#L1470) does not populate those compatibility subagent tabs; its pending-request reads at [stream.native.ts](../../packages/apexo/src/cli/cmd/run/stream.native.ts#L62) also target only the root.
- Minimum correction: Supply the authoritative native Session/Task family to the form watcher, using existing child ownership/query mechanisms. Add a real mini PTY case in which an ordinary child requests a form. No new table or interaction framework is needed.

### F04-A02 — P2: Fullscreen TUI omits an eligible grandchild's form

- Requirement: Interactive descendants remain eligible under section 5.4; E09 requires an actionable terminal dock rather than a backend-only pending responder.
- Observed: In a root → child → grandchild foreground Task tree with `task.maxDepth=2`, the grandchild's form was live and answerable through the API. The root fullscreen terminal requested root and direct-child lists, but never requested the grandchild list. No form appeared after two additional root hydration cycles.
- Evidence: `rootQueried=true`, `childQueried=true`, `grandchildQueried=false`, `formVisible=false`. The pending request was explicitly declined through the API afterward.
- Cause: [session/index.tsx](../../packages/tui/src/routes/session/index.tsx#L189) builds `children()` from a parent and its immediate children. The form watcher at [line 225](../../packages/tui/src/routes/session/index.tsx#L225) uses that shallow collection without traversing descendants. App's existing `sessionTreeIDs` traversal does not have this particular shallow-filter limitation.
- Minimum correction: Enumerate the actual Session subtree for hydration and retain the existing stable dock. Add an interactive nested-Task fullscreen case.

### F04-A03 — P2: A legal field name is confused with an inherited draft property

- Requirement: Section 5.1 supports flat primitive properties and optional fields without requiring server defaults. Exact user input must remain typed; an absent optional number must not become a function.
- Reproduction schema: `{"type":"object","properties":{"toString":{"type":"number"}}}`. Core accepts this schema and accepts `{ "action": "accept", "content": {} }` because the number is optional.
- Observed with the actual shared helpers: `elicitationDefaults` returns an object with no own draft keys, but `typeof drafts.toString` is `"function"`. Passing these untouched defaults to `elicitationContent` returns `{ "invalid": "toString" }` instead of an empty content object.
- Cause: [mcp-elicitation.ts](../../packages/sdk/js/src/v2/mcp-elicitation.ts#L31) reads `drafts[field.name]` on an ordinary object without checking ownership. Optional numeric names inherited from `Object.prototype`, such as `toString` and `valueOf`, are therefore treated as provided values. The App and shared TUI submitters both use this helper, and their raw draft display reads can also expose inherited values.
- Scope of verification: This was reproduced against the production parser and draft/submit helpers. A browser or Desktop rebuild was not performed for this edge case during this audit.
- Minimum correction: Use own-property reads or an appropriately handled dictionary for drafts/content, and add a valid special-name optional-field regression. Do not solve this by silently inventing a new undocumented schema restriction.

## Acceptance evidence still needing completion or clarification

These are evidence gaps, not additional reproduced production defects.

1. **Stateless HTTP scope:** The delivery exit condition mentions stateful/stateless stdio and HTTP fixtures. Both branches of the current HTTP test construct `sessionIdGenerator: () => crypto.randomUUID()` at [mcp-elicitation.test.ts:220](../../packages/apexo/test/v2/mcp-elicitation.test.ts#L220), and both assert the presence of a session-id. The “stateless” option only fixes the fixture tool's counter at 1. This demonstrates a stateless tool over a stateful MCP transport, not sessionless HTTP interoperability. The implementation checkpoint explicitly acknowledges that limit. Clarify the plan's meaning or supply the corresponding real fixture before claiming that wider acceptance scope.
2. **E04 / E06 / E07 negative paths:** The checked-in evidence verifies cancellation, queued-client rejection, explicit MCP reconnection, resource rejection, duplicate replies and frontend reload. It does not directly inject an old generation's late form while a successor call is active, restart the backend while a frontend holds a pending request and then submit the stale reply, or elicit during SDK initialization/idle. The code contains guards for these cases; this review does not claim those guards are broken. The required direct evidence is still absent from the inspected fixtures and was not supplied by the baseline run.

## Requirement comparison

| Plan item                                             | Audit assessment                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 / E01 — typed fields and defaults                 | Main typed paths implemented and covered. Special-name optional numeric drafts fail (A03). Sessionless HTTP evidence is not established.                                                                   |
| 5.1 / E02 — Core validation and limits                | Flat schema/reply validation, bounds, required fields, formats, strict unknown keys and limits are present. Existing focused checks pass.                                                                  |
| 5.2 / E03 — shared connection and resource isolation  | Per-Client gate, shared stdio state, two Sessions and unarmed resource rejection are covered by current integration tests.                                                                                 |
| 5.2 / E04 — cancellation and late forms               | Ordinary cancellation paths are implemented and covered. A real late-generation incoming form is not directly covered by the inspected fixtures.                                                           |
| 5.3 / E05 — active, human and hard budgets            | Implemented; short real-SDK timer tests, repeated pauses and queued-dispatch rejection pass.                                                                                                               |
| 5.3 / E06 — reload, reconnect and restart             | Frontend reload and explicit MCP reconnect are covered. Backend restart with a cached pending request needs direct evidence.                                                                               |
| 5.2–5.3 / E07 — unarmed/concurrent/duplicate requests | Resource/missing-interaction rejection, a concurrent second form and duplicate replies are covered. Initialization/idle request injection needs direct evidence.                                           |
| 5.4 / E08 — backend eligibility                       | Native runner tests cover manual/allowed permissions, both headless policies, headless descendants, scheduled launches/descendants and an interactive child. They pass. F02 remains separate planned work. |
| 5.4 / E09 — mini/fullscreen/App/Desktop               | Original root-Session acceptance exists for all four surfaces. Native mini child hydration and fullscreen deeper descendants fail in current real PTY probes (A01/A02).                                    |
| Architecture scope                                    | No new elicitation database table, per-call MCP process, replacement orchestration runtime or SDK upgrade was introduced. The defects can be addressed within existing mechanisms.                         |

## Verification performed in this review

- Re-ran `bun test test/v2/mcp-elicitation-form.test.ts test/v2/mcp-elicitation.test.ts test/v2/mcp-elicitation-runner.test.ts test/v2/mcp-elicitation-client.test.ts test/event-manifest.test.ts` from `packages/apexo`: **27 passed, 0 failed, 180 assertions**.
- Used isolated real native backends, a real MCP stdio peer, a controlled HTTP model provider and real PTYs for direct-child mini and nested fullscreen cases. Recorded actual pending responders, terminal screens and subsequent hydration request paths. A nested mini case also omitted descendant requests.
- Executed the actual Core form parser and shared SDK draft/content helpers for the prototype-name reproduction.
- A PageDown smoke probe after visiting enum fields and returning to a text field did not crash or close the fullscreen dock; it is not reported as a defect.
- Confirmed PR #207 is still an open draft at the reviewed commit. Its required `typecheck` and `unit (linux)` checks are successful; that does not cover the new cases above.
- Did not repeat the entire repository gate, all HTTP exerciser modes, production benchmarks or rebuilt Desktop acceptance during this review.

Only this audit report was added to the repository. Production code was not edited; no commit, push or merge was performed. Probe drivers and raw logs were kept outside the repository, and only test-owned processes were started/stopped.
