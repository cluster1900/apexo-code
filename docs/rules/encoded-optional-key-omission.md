# RULE-20261015-021: Omit absent encoded optional keys

- **Scope:** Adapters that construct encoded input for a Schema with optional keys, including plugin metadata, native project rows and Feedback saves.
- **MUST:** Respect the encoded schema's absence semantics. Omit an optional key when the source has no value, using a conditional object spread or the already validated object. Test the actual empty/omitted source case at the boundary.
- **NEVER:** Convert a missing or SQL-null value into an explicit `undefined` property before an encoded optional-key decoder, or assume the decoded and encoded sides accept the same object.
- **Verification:** Exercise the real decoder/service with omitted metadata and with populated values; run the affected package's `bun typecheck`. Preserve typed rejection of malformed present values.
- **Source:** [BUG-20261014-170](../testing/runtime/plugin-embedded-skill-optional-description.md) records three independent adapters: embedded bundle skill description, native project catalog nulls, and Feedback text-only image preservation.
