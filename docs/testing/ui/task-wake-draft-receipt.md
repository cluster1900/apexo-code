# Task wake loses the initiating message receipt on launch refresh

- Bug ID: BUG-20261015-362
- Scope: Shared SDK Task message drafts used by App and TUI.
- Status: Verified in the real HTTP client fixture and shared rebuilt browser/native acceptance.

Task summary `startedAt` identifies a launch, not the durable child incarnation. A completed Task operator message starts a new launch. The existing draft cache discarded the submitted input when a refreshed summary supplied that new timestamp, so the message receipt disappeared. The first client proof failed with the expected promoted receipt versus `undefined` (two existing tests passed, the new test failed).

Submitted inputs now survive a timestamp change only in reconciliation-only mode. Their exact input ID remains visible, but Send and Next cannot create another POST until a receipt GET succeeds under current parent/child ownership. Unsubmitted editable drafts still invalidate. A generation fence ignores POST responses and GET responses from a retired cache generation. A missing receipt leaves the input locked for read-only reconciliation; it never implicitly resends it into a replacement child.

Verification from `packages/apexo`: `bun test test/cli/run/task-message.test.ts` covers successful exact-receipt reconciliation, GET404 blocking Next and POST, a late held POST response after launch change, existing uncertain admission/retry, permission rejection and invalid UTF-8 size. The focused run passed four tests with 29 assertions. No public Protocol/Schema changed; the handwritten SDK module must be included in the normal SDK build before aggregate gates.

Shared acceptance: browser and native completed-wake checks pass all three deliveries with two child turns each. A native close/reopen extension retains the exact promoted receipt ID and New message clears the draft without another provider request in every mode. All21 types and the combined builds pass. The unrelated initial package-hook deadline observation remains BUG363.
