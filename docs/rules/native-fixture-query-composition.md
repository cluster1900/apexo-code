# RULE-20261015-020: Compose native fixture query parameters explicitly

- **Status:** Active after integration.
- **Scope:** Native CLI/Desktop acceptance callers of `grok-shell-fixture.api` and similar helpers that append Location query parameters.
- **MUST:** Inspect the helper's URL composition before passing a queried endpoint. Use `URL` and `searchParams` with the actual fixture origin when the helper only accepts a query-free path; preserve explicit chronological order and Location parameters.
- **NEVER:** Pass `/message?order=asc` to a helper that unconditionally appends `?directory=`. Do not remove order validation or change product query decoding to accommodate a malformed fixture URL.
- **Verification:** Exercise the real HTTP caller and assert chronological transcript content across two turns. A syntax check alone does not prove the final composed query.
- **Source:** [BUG-20261015-112](../testing/test-fixtures/native-media-query-delimiter.md), four independent media, nested Task, completed-child Task and Task resume script-authoring episodes.
