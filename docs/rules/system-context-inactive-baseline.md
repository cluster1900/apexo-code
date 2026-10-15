# RULE-20261015-006: Nonempty inactive SystemContext sources

**MUST** omit an inactive source only when the SystemContext composition contract permits it, or render a meaningful nonempty neutral baseline; **NEVER** register an inactive source whose baseline is empty or whitespace.

- **Status:** Active; integrated and indexed.
- **Source:** [BUG-20261014-074](../testing/runtime/hooks-empty-context.md), three independent occurrences.

## Scope

Domain-owned sources admitted to native SystemContext initialization and reconciliation, including optional hooks and asynchronous Task completion data.

## Required behavior

- Check both initial and updated empty states. An update renderer does not protect the independent baseline renderer.
- Preserve semantic meaning: an inactive baseline should describe the absence of current data, without inventing instructions or active work. Do not use placeholder whitespace to satisfy validation.
- Verify the actual `SystemContext.initialize` path with the inactive state and exercise a real native Session that has no active data for the source. Keep active and cleared-state coverage where those transitions are supported.
- When a provider fixture has no calls, retain the original initialization failure before changing deadlines or inferring a transport defect.

## Evidence

[BUG-20261014-074](../testing/runtime/hooks-empty-context.md) records three independent integrations/source-authoring episodes with the same empty-baseline contract violation. The background Task episode reproduced the initializer failure before any provider call and verified a meaningful neutral renderer through the real initializer and native HTTP execution.
