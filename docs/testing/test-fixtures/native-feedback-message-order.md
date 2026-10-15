# Native Feedback Acceptance Message Order

- **Bug ID:** BUG-20261014-143
- **Type:** Test fixture
- **Scope:** CLI and Desktop native Feedback and MCP resource acceptance
- **Status:** CLI and packaged Desktop verified
- **Independent occurrences:** 3

## Observed and expected behavior

The missing-draft update assertion selected a completed tool from an earlier
turn instead of the current error result. It must inspect the current turn.

## Reproduction and cause

Run `bun script/grok-feedback-parity.mjs cli --native` from `packages/apexo`.
The first adapter used an array-length slice as though native messages were in
ascending order. The native list defaults to descending order, so the slice
selected older messages after the new turn was inserted.

## Fix and verification

Capture prior message IDs, await the native execution receipt, and inspect
messages whose IDs were absent before the prompt. This avoids relying on list
ordering. The CLI rerun passed all eight scenarios with six provider requests,
including the missing update error and real process restart. The first CLI run preceded the rebuilt Desktop gate.

The refreshed production Desktop backend also passed the same eight native scenarios with six provider requests after the shared build. The fixture processes were reaped.

## Independent MCP resource acceptance occurrence

The native MCP resource CLI script initially selected the last tool in the
returned message array. On its second prompt this selected the earlier resource
list result instead of the current template result, causing an undefined
`resourceTemplates` assertion. This is the same incorrect ascending-order
assumption, independently introduced in the new fixture. The correction captures
prior message IDs before each prompt and inspects only newly created messages.
Command: `bun script/grok-mcp-resources-native.mjs cli` from `packages/apexo`.
The CLI and packaged Desktop reruns each passed 11 scenarios with 20 provider
requests. All fixture processes were reaped. No product implementation changed.

## Independent native Task transcript occurrence

The new native Task E2E fixture asserted initial-request then follow-up ordering while requesting the default message list. The real provider sequence and all three Task tool receipts had succeeded, but the final user-message assertion received follow-up then initial-request. Core intentionally defaults to descending event sequence. Request `order=asc` when asserting the chronological transcript; do not sort away an execution-order defect. The corrected isolated three-file Task checkpoint passed three tests and 44 assertions, including provider request inspection of both initial and follow-up context. This is the third independent exact ordering-assumption episode. It is a fixture error, not a change to the public API default. See [RULE-20261015-002](../../rules/native-message-query-order.md).

Shared integration verification: the combined native Task and command-sandbox gate passed 23 tests / 284 assertions across twelve files, including the canonical Task initial/follow-up transcript. All 21 repository typecheck tasks passed. This verifies the third episode after integration and activates RULE-20261015-002; it adds no recurrence.
