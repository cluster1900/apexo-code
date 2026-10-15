# BUG-20261014-070: Stop integration used a nonexistent Session lookup

- **Scope:** Legacy Session Stop-hook integration typecheck.
- **Observed:** Package typecheck rejected `sessions.getMessage`; the Session service exposes `findMessage`, not that method. The invalid lookup also widened the runner Effect error/environment types.
- **Expected:** Look up the actual persisted assistant through the existing Session service.
- **Reproduction:** Run `bun typecheck` in `packages/apexo` with the initial Stop boundary patch.
- **Root cause:** The adapter assumed a lookup method name instead of using the existing service contract.
- **Fix:** Use `findMessage` with the assistant ID and handle its Option result.
- **Verification:** Package typecheck passed after the lookup correction; CLI Stop continuation acceptance subsequently passed. A later test fixture insert hit the existing non-distributive message-data union type; using the real assistant Schema encoder gives the insert its correct encoded type. Final package rerun pending.
- **Occurrences:** One observed typecheck failure.
