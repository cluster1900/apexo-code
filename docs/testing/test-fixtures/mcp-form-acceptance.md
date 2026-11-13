# BUG-20261113-F04-003: Form acceptance fixtures selected the wrong target

- Scope: F04 real HTTP and App/Desktop acceptance fixtures.
- Observed: Reusing an SDK stateless transport for multiple HTTP requests throws its documented reuse error. An App test checked the first multi-select checkbox twice because `:last-of-type` matched each label's input. Offscreen checkbox actions also hit the fixed footer until the test scrolled the control into view.
- Expected: Acceptance exercises the intended transport/server semantics and the exact visible control without bypassing user interactions.
- Reproduction: Run the initial HTTP form test and `bun script/mcp-forms-ui.mjs browser` from `packages/apexo`.
- Root cause: Fixture topology confused stateless tool behavior with the SDK's single-request stateless transport; selectors assumed inputs shared one parent, and automation checked click interception before scrolling.
- Fix: The HTTP suite explicitly distinguishes stateful tools from a stateless tool implementation while both use a shared MCP session/transport for bidirectional elicitation. The UI fixture selects the last option's label and scrolls each real control into view before acting. It compares the completed tool's returned typed reply, rather than historical tool arguments.
- Verification: Browser App and rebuilt Desktop with its own authenticated sidecar pass prefill, validation, reload hydration, exact typed accept, decline, Escape cancel and Session interrupt. Mini/fullscreen real PTYs pass editing, validation, explicit review/submit, decline and cancel.
- Limit: The stateless-tool HTTP case does not claim that SDK sessionless, one-request transports support bidirectional elicitation.
- Occurrences: One acceptance-authoring episode.

## Audit repair acceptance corrections

The HTTP evidence now includes an actual sessionless transport, with a fresh SDK HTTP transport per request and no request/response `mcp-session-id`. The single test client uses a fixture bridge to correlate only in-flight HTTP messages; it advertises normal SDK capabilities during initialization and forwards `relatedRequestId` for the tool's form stream. This supersedes the original stateless-tool limitation above without changing the production SDK or MCP orchestration.

Special-name acceptance exposed the SDK fixture's default AJV validator inspecting inherited `toString`/`valueOf` properties even after Apexo sent correct JSON. The fixture validates a copy containing only own JSON fields with a null prototype, retaining actual AJV schema checks. It does not loosen Apexo validation. A native API probe also launched a Task before warming the MCP catalog; its captured tool set correctly excluded the unavailable tool. The probe now explicitly connects MCP before delegation. An HTTP end-to-end assertion was corrected from 200 to the endpoint's declared 204 for payload-free `wait`; no production change was needed for either fixture assumption.

The expanded API fixture restarts only its own isolated backend on the same reserved port. It holds a request in a real SDK watcher, observes empty hydration after restart, requires 404 for the stale reply and verifies no provider call replay. Exact final verification results are in [the implementation checkpoint](../../development/f04-implementation.md).

## App/Desktop interaction follow-up

The expanded Desktop acceptance passed input navigation, field ordering, explicit keyboard submit, Decline, Cancel and Session interruption, then timed out waiting for the first child form. The completed child's tool state was `error` with `Tool unavailable to this native Task child`: the previous interruption had retired the MCP connection before the child's tool catalog was captured. The UI fixture now explicitly reconnects the test server after interruption and before descendant launches, matching the existing API probe's catalog warm-up. This changes fixture setup, not the production retirement contract. A rerun alone is not treated as evidence of the cause; the exact completed tool error and the explicit connection transition establish the correction. Final browser/Desktop results are recorded in the implementation checkpoint.
