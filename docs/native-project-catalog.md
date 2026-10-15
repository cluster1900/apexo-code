# Native project catalog and current identity

The native server provides the project reads required by App workspace bootstrap:

- `GET /api/project` returns persisted project metadata from Core's project table, including names, icons, commands, timestamps and sandbox directories. An empty table returns an empty array. Invalid stored data or a read failure returns a sanitized typed 503 error; it does not become empty success.
- `GET /api/project/current` takes the standard Location query and returns `{id, directory}` from the resolved Location. Its identity is the same one used when creating native Sessions, including plain directories and Git worktrees.

Project catalog reads do not start model work or modify project metadata. Current identity uses Apexo's existing Project/Location resolution; it does not delegate to the compatibility runtime. The shared App continues to use its existing project contracts and error handling. No error toast was suppressed to make bootstrap appear successful.

This corrects [BUG-20261014-274](testing/ui/native-project-bootstrap-api.md): the production App previously called absent native project routes, received 404 responses, and displayed a workspace reload error while leaving bootstrap partial.

## Verification

From `packages/apexo`:

```sh
bun test test/project/native-catalog.test.ts test/e2e/v2-project.e2e.test.ts
bun script/grok-native-project-catalog.mjs cli
bun script/grok-native-project-catalog.mjs desktop
```

The Core/HTTP tests passed three tests and 28 assertions. Dedicated real CLI and final rebuilt Electron Desktop backend runs each passed four checks with zero provider calls, including process restart. Core, Apexo and Server package type checks passed; the two public HTTP inventory scenarios passed.

Production browser and actual native-window acceptance each passed the Goal fixture's 15 checks and MCP manager fixture's 12 checks with both project reads returning 200 and no UnexpectedStatus reload toast. Final native screenshots were also visually inspected. This is verification of Apexo's existing project-identity architecture, not a new claim about Grok project APIs.
