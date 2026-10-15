# MCP OAuth reference environment rewriting

- **ID:** BUG-20261015-038
- **Scope:** Off-tree installed-reference OAuth probe; one fixture authoring occurrence, not shipped Apexo behavior.
- **Observed:** The first probe's configured HTTP server was absent from the Session. A later explicit ACP server could authenticate dynamically, but configured OAuth client metadata was not consumed. Credentials appeared under the private HOME fallback rather than the intended private Grok configuration directory.
- **Expected:** HOME and GROK_HOME independently identify the intended private fixture locations, and configured client credentials are loaded from the written configuration.
- **Reproduction:** Derive the probe using a substring replacement of `HOME: home` in a child environment object that also contains `GROK_HOME: home`; start the installed agent and inspect its safe server status and credential-file placement.
- **Root cause:** The substring rewrite also matched the suffix inside `GROK_HOME`, replacing that property with an unrelated name and duplicate HOME/PATH entries. The installed runtime consequently used its HOME-based fallback. Both locations remained inside the isolated fixture; no real user credentials were used.
- **Fix:** Restore explicit separate HOME and GROK_HOME properties. Inspect the final environment source and assert configured-client behavior rather than inferring it from successful dynamic registration.
- **Verification:** The corrected off-tree `bun official.mjs` configured-client run passed five checks with zero provider requests. The token exchange occurred without a registration request; restart reused credentials and a rejected token refreshed without another consent. The credential document existed at the intended configured home, was absent from the fallback home, and had mode 0600. All three recorded agent PIDs were absent after awaited cleanup. The earlier dynamic-registration pass remains separately scoped evidence.
