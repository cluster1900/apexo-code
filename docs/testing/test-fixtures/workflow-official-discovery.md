# BUG-20261014-063: Official saved-workflow comparison ignored project trust

- Scope: Isolated installed-runtime comparison fixture only; no Apexo product dependency on the official runtime.
- Observed: The comparison placed a saved script under an untrusted project's workflow directory. The installed runtime reported an unknown workflow and made no child provider call; the fixture timed out.
- Expected: The fixture discovers its own isolated saved script and observes the actual workflow terminal event.
- Reproduction: Run the original comparison with a fresh HOME and GROK_HOME and a project-scoped script without granting project trust.
- Root cause: Official discovery filters project workflows by folder trust. The fixture did not establish trust. Its initial broad text-based completion predicate could also match the command turn completion before the workflow finished.
- Fix: Store the script under the isolated user workflow directory. Require the typed workflow_updated notification with status complete and the expected result_summary. Identify the child provider request by its exact user message, excluding title-generation requests.
- Verification: `bun script/grok-workflow-official.mjs` from `packages/apexo` passed two checks with two provider calls and exactly one independent workflow child; typed completion and exact result were observed. The intermediate strict predicate timed out because the official status is complete, not completed; captured events showed a successful workflow and exposed this fixture expectation error.
- Occurrences: One discovery failure and one subsequent terminal-status fixture mismatch; no product failure or recurring constraint claimed.
