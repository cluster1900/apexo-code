# MCP OAuth reference extension request fields

- **ID:** BUG-20261015-039
- **Scope:** Off-tree installed-reference OAuth probe; one authoring occurrence, not shipped Apexo behavior.
- **Observed:** Explicit authentication returned authenticated and the server recorded successful initialization/tool discovery, but the next catalog assertion could not find the expected ready Session server.
- **Expected:** The catalog request selects the same Session that completed authentication.
- **Reproduction:** Use a shared extension helper that sends `session_id` for both auth methods and `mcp/list`, then assert the Session-specific ready server.
- **Root cause:** Reference auth-status/auth-trigger payloads use `session_id`, while the list request schema uses camel-case `sessionId`. The helper incorrectly treated the extensions as one payload shape.
- **Fix:** Select the documented field shape by method. Keep the initial needs-auth assertion so missing server admission cannot count as successful passive authentication behavior.
- **Verification:** The corrected dynamic-registration probe passed five checks with zero provider requests, including ready tools, stored-token restart and refresh without renewed consent. The final configured-client probe also passed five checks with zero provider requests. Both runs awaited all installed agent exits; no recorded agent PIDs remained. Commands were `bun official.mjs` from the isolated audit directory, not repository product tests.
