# Native Compaction Message Shape

- **Bug ID:** BUG-20261014-138
- **Type:** Test fixture
- **Scope:** Native Memory production acceptance
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

The local provider completed real native compaction and the refreshed memory
index appeared in the next request, but the fixture rejected the projected
compaction message because it expected `time.completed`.

## Reproduction and cause

Run `node script/grok-memory-native-context.mjs cli` from `packages/apexo` with
the original assertion. `SessionMessage.Compaction` has `reason`, `summary`,
`recent` and base timestamp fields; it does not use the assistant completion
field. A completed compaction is projected from its ended event.

## Fix and verification

Check the actual projected compaction's `reason: auto` and local-provider summary
content. Do not invent a completion field or alter the product schema for the
fixture. CLI and rebuilt Desktop each passed seven scenarios and twelve provider requests, including real native automatic compaction, restart, permissions and memory invalidation.
