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
