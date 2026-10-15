# BUG-20261015-332: Attachment prepare used a top-level union payload

- Scope: Native Protocol attachment preparation and generated Client.
- Observed: `bun run generate` from `packages/client` rejected the prepare payload with `Input schema must be a struct`.
- Expected: Public contracts must be consumable by the supported generator without editing generated output.
- Root cause: Resource/template alternatives were declared directly as the endpoint payload; the generator enumerates fields of a top-level struct.
- Fix: Wrap the tagged union in the struct field `resource`. Preserve the union's validation and use the generated Client output.
- Reproduction: Run the generator with the original top-level union payload.
- Verification: Supported generation passes with the wrapper; both real HTTP hosts accept resource preparation and return validated snapshots.
- Occurrences: One authoring episode.
