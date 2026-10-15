# RULE-20261015-010: Keep fixture configuration in one supported dialect

- **Scope:** Native/compatibility acceptance fixtures and helpers that compose configuration documents.
- **MUST:** Inspect the helper's actual config dialect before extending it. Keep legacy `provider`/`agent`/`permission` documents consistently V1, or write a complete V2 document with native providers/agents/permissions. Verify the effective behavior at the real API/provider boundary.
- **NEVER:** Spread V1 discriminator keys into a document and expect native-only fields to survive V1 decoding/migration. Do not relabel an ignored fixture field as a product authorization failure.
- **Verification:** For denial scenarios prove that a real configured deny exists, reject the action, and assert no forbidden provider/tool work. Preserve the failed setup result and corrected acceptance evidence.
- **Source:** [BUG-20261014-252](../testing/test-fixtures/goal-role-config-dialect.md), three independent fixture construction episodes: Goal agents, MCP servers and Plan permissions.
