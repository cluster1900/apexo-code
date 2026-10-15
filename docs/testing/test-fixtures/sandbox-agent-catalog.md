# BUG-20261015-069: Sandbox Bash fixture omitted its real Agent registration

- **Scope:** Isolated native command sandbox Bash test; no product permission fix.
- **Observed:** The first real tool call returned an error before the expected filesystem assertions. A diagnostic run captured `PermissionV2.BlockedError` with a wildcard deny rule.
- **Expected:** The intended positive case runs under an explicitly configured fixture Agent, while a missing Agent remains denied before any process execution.
- **Root cause:** The fixture compiled the Bash and Permission service graph directly, without the production Agent configuration plugin registration. Writing a configuration file alone did not populate the bare `AgentV2` catalog. The real Permission service correctly applied its missing-Agent deny floor.
- **Fix:** Register the fixture build Agent through the real scoped `AgentV2.transform` API and expose that service in the fixture graph. Preserve the real Permission service and add the explicit missing-Agent negative case; no mocked allow or production policy relaxation is used.
- **Reproduction:** Compile the bare Bash/Permission graph with no Agent registration, then settle a build-Agent Bash call through the actual ToolRegistry.
- **Verification:** The corrected isolated real Bash test passed. It verifies kernel write denial, successful allowed output, exact launcher marker removal, a confirmed receipt, and that the missing-Agent call creates neither its output file nor a replacement receipt. Diagnostic-only logging was removed before the passing rerun.
- **Occurrences:** One new fixture-construction episode; no recurring constraint promoted.
