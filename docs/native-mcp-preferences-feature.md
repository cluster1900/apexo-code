# Native MCP saved connection choices

Status: accepted for the scoped native persistence capability on 2026-10-15. Aggregate repository gates are tracked by the coordinated checkpoint.

Previously the native connection manager changed only the current Location runtime.
Successful explicit Connect and Disconnect actions now save a
personal choice for the full Location. Retry remains a runtime operation. Use
configuration removes the saved override and applies the current loaded trusted
configuration. No shared project configuration is edited.

## Reference and scope

A fresh isolated installed 1.0.52 (`0920c8169e27`) comparison on 2026-10-15
passed five checks with four provider requests: disable persistence, restart
while disabled, re-enable, actual tool execution, and a subsequent enabled
restart. The earlier comparison in [native MCP runtime](native-mcp-runtime.md)
is retained as dated evidence; neither run establishes later-version behavior.
The pinned source uses personal `disabled_mcp_servers` state and an enable
transaction with rollback. Apexo intentionally stores choices per full Location
rather than reproducing the reference's user-global TOML and project-file edits.

Apexo remains responsible for configuration trust, Session execution, permissions,
tools and processes. Saved names cannot create a definition or bypass plugin
trust. OAuth setup remains unavailable in the native manager. No foreign runtime
is embedded or needed by the product.

## Contract

- Existing bodyless Connect and Disconnect requests save true or false only after
  their prepared activation succeeds. Failed candidates preserve the prior choice.
- Retry does not write preferences. It checks the latest saved choice under the
  shared lock immediately before publishing a replacement; a newly saved disable
  prevents that replacement. A previously healthy runtime can remain active until
  its process reloads or performs a successful explicit action.
- Bodyless `POST /api/mcp/:server/resetPreference` clears the override and applies
  current loaded configuration. Cached host configuration is not rediscovered by
  this action. A new Location/process loads edited host configuration normally.
- Native status adds optional `configuredEnabled`, `preference`, and
  `preferenceError`. The connection status describes actual runtime state. Saved
  choice metadata is the snapshot observed by this Location's last load/action;
  other processes do not receive live preference broadcasts.
- Missing definitions are neither shown nor started. Their saved names may remain
  for a later trusted reinstallation. Removing a definition does not turn a saved
  name into an executable configuration.

## Storage and lifecycle

A versioned private user-data document uses a SHA-256 basename derived from the
normalized directory and optional workspace identity. Server identifiers are
bounded array data, never filenames or object-property writes. No credentials,
commands or environment values are copied into this store.

The store validates ownership, duplicate identifiers, size and schema. A shared
cross-process lock surrounds read-modify-write and activation. Private temporary
files, atomic rename, and file/directory synchronization publish the update. A
failed activation restores the previous bytes only if both the staged revision
and exact bytes still belong to that transaction. A newer writer's choice is
never overwritten by rollback.

Waiting for the lock is cancelable. A scoped finalizer owns the acquisition
promise before cancellation is restored, aborts pending acquisition, and releases
any lease won in the abort race. Saving and synchronous activation are
uninterruptible together; retirement follows publication even if the caller is
canceled. A retained transport is checked again immediately before publication.

Malformed/unreadable preferences fail closed during initial Location activation:
configured servers remain visible as failed, no transports start, and Session
construction can still finish. An existing working generation is retained on a
failed reload. The manager reports a safe localized storage error without paths
or secrets. Damaged storage is not silently overwritten.

## Verification and limits

| Surface | Accepted result |
| --- | --- |
| Live preference and existing MCP suites | 24 tests / 201 assertions (12 / 104 plus 12 / 97) |
| Installed reference 1.0.52, fresh isolated profile | Five checks / four provider requests |
| CLI native controls | 11 scenarios / nine provider requests |
| Packaged Desktop native controls | 11 scenarios / nine provider requests |
| Production browser, en/zh/zht | 16 checks / zero provider requests |
| Actual native window, en/zh/zht | 16 checks / zero provider requests |
| Native shared action PTYs, narrow and expanded | Nine checks each / zero provider requests |
| Actual mini and fullscreen compatibility entry points | Four checks each / zero provider requests |

The focused tests cover process restart, concurrent writers, directory/workspace
isolation, explicit reload, disabled configuration and reset, removed definitions,
failed/canceled candidates, corrupt storage, private modes, failed writes, hostile
identifiers and exact rollback fencing. The two publication races were reproduced
before correction; the lock test covers cancellation both while waiting and after
acquisition. These are Apexo implementation tests, not upstream verification.

CLI/Desktop checks use real native Session/tool execution and two process-restart
boundaries, preserving shared configuration. Management/reset/restart actions add
no provider work. All eleven recorded MCP starts in each CLI/Desktop run were
reaped. The browser and native-window runs each reaped all twelve MCP child starts;
the narrow and expanded native PTY runs each reaped all eight starts.

Browser and actual native-window captures were inspected in English, Simplified
Chinese and Traditional Chinese. Saved enable/disable choices and Use
configuration are visible. The localized storage failure wraps without obscuring
the active row controls, retains connected/tools-one state, and disappears after
restoring exact preference bytes and retrying. A prior failure toast can remain
briefly after the inline status has recovered. Both MCP dialog and status-popover
entry points were exercised. The narrow PTY also keeps its saved choice and
configuration shortcut visible while the safe storage message wraps.

Commands from `packages/apexo`:

- `bun test test/v2/mcp-preferences-native.test.ts test/v2/mcp-native.test.ts`
- `bun script/grok-mcp-controls-native.mjs cli` and `desktop`
- `bun script/grok-mcp-controls-official.mjs`
- `bun script/grok-native-mcp-ui.mjs desktop --locales` and `native --locales`
- `bun script/grok-native-mcp-tui.mjs` and `--fullscreen`
- `bun script/grok-mcp-tui.mjs` and `--fullscreen`

Coordinated App/Desktop builds and all 21 package typechecks passed. A prior
partial-copy Apexo typecheck mixed copied and live dependencies and is not
counted as validation; coherent live checking supersedes it. The reset endpoint
has a bodyless missing-server HTTP exercise case. Aggregate unit/HTTP and final
generated consistency belong to the coordinated checkpoint, not these scoped
acceptance counts.

Native shared-action PTYs do not claim complete native-only terminal bootstrap;
the actual mini/fullscreen entry checks use compatibility protocol selection.
OAuth setup, cross-process live broadcasts and discovery of edited host files
remain outside this slice. Other locales use the English fallback for new keys;
no native-speaker review is claimed.

The earlier installed 1.0.52 result was recorded on 2026-10-14 at 22:39 +0800
(five checks / four provider requests). The current 2026-10-15 comparison repeated
the same five checks once for this completed persistence feature, with identical
counts. All three installed agent processes exited and all three recorded MCP
child PIDs were absent after cleanup. The acceptance report now describes the
installed comparison without the obsolete claim that Apexo controls are runtime-only.

- [Retry publication race](testing/runtime/mcp-preference-retry-publication.md)
- [Retained transport publication race](testing/runtime/mcp-preference-retained-transport.md)
- [Cancelable preference lock acquisition](testing/runtime/mcp-preference-lock-cancellation.md)
- [Metadata fixture correction](testing/test-fixtures/mcp-preference-status-metadata.md)
- [Localization review](native-mcp-preferences-localization.md)
