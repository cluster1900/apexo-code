# RULE-20261015-002: Choose Native Message Query Order Explicitly

- **Status:** Active.
- **Source:** [BUG-20261014-143](../testing/test-fixtures/native-feedback-message-order.md), three independent Feedback, MCP resource, and Task fixture episodes.
- **Scope:** Native Session message-list tests and acceptance scripts.
- **MUST:** Request `order=asc` when asserting chronological transcript order. When isolating a new turn, capture prior message IDs and select newly observed IDs after the execution receipt.
- **NEVER:** Assume the default list is ascending, select a new turn by array-length slicing, or select the newest tool by the final array element without choosing the query order.
- **Verification:** Exercise at least two distinct turns so an earlier result cannot accidentally satisfy the current assertion. Preserve assertions about actual model context and durable execution order; do not sort messages merely to hide an ordering failure.

The public native API defaults to descending event sequence. This rule fixes fixture assumptions and does not change that contract.
