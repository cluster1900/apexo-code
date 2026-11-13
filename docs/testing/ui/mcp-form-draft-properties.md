# BUG-20261113-F04-007: Inherited draft properties blocked valid optional form fields

- Scope: Shared SDK draft/content helpers and App/Desktop/mini/fullscreen input rendering.
- Observed: A valid optional numeric field named `toString` had no own draft value, but reading the ordinary draft object returned `Object.prototype.toString`. Explicit submission then failed as an invalid number. Raw UI reads could also display inherited values.
- Expected: An absent optional field is omitted. Explicitly edited prototype-named fields retain their typed values; `false`, empty valid enums and copied array defaults retain their existing semantics.
- Reproduction: Parse a flat schema with optional `toString: { type: "number" }`; pass untouched `elicitationDefaults` to `elicitationContent`. Before the fix, the new regression returns `{ invalid: "toString" }` instead of empty content.
- Root cause: Draft reads did not distinguish own fields from inherited object properties.
- Fix: One shared own-key reader is used by submission and every UI draft read. Own-key enumeration also subscribes Solid stores to a previously absent field's first edit. A first repair using only `Object.hasOwn` reproduced a stale optional-choice marker in a real mini PTY; enumeration corrects that reactive boundary.
- Verification: The regression first failed on the original helper and passes after repair. Real four-surface acceptance leaves optional prototype-named number/text/choice fields absent, then edits them explicitly and checks the completed MCP tool result. Terminal acceptance also asserts the optional choice marker changes immediately. Final results are in [the implementation checkpoint](../../development/f04-implementation.md).
- Occurrences: One audited inherited-property defect and one repair-time reactive regression; no recurrence rule is inferred.
