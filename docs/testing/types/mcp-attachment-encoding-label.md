# BUG-20261015-330: MCP attachment decoder encoding label

- Scope: New native MCP attachment materialization.
- Observed: The first Core typecheck rejected `new TextDecoder("utf8")` with TS2345.
- Expected: The decoder uses a supported typed UTF-8 label and rejects malformed bytes.
- Root cause: The draft used Buffer's accepted encoding spelling in the narrower TextDecoder API.
- Fix: Use `utf-8` for TextDecoder; preserve canonical Buffer conversion separately.
- Reproduction: Run `bun typecheck` from `packages/core` with the original label.
- Verification: The corrected Core typecheck passes. The materialization test exercises malformed UTF-8 rejection and exact Unicode bytes.
- Occurrences: One authoring episode; no recurring constraint is claimed.
