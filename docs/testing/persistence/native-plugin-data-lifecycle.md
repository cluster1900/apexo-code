# BUG-20261015-375: Native Plugins lacked persistent data ownership

- **Type:** Missing native persistence capability.
- **Scope:** Installed native Plugins, captured command hooks, component substitution, uninstall, CLI, App, and terminal Plugins controls.
- **Observed:** A valid native command-hook negative control returned author-supplied `/forged` values for both plugin-data aliases. Native activation supplied no owned persistent directory, and uninstall had no data-retention contract.
- **Expected:** Trusted installed identity owns a stable writable directory; host aliases override handler fields; update and restart retain data; keep-data uninstall preserves it; default uninstall retires it without deleting underneath captured users.
- **Cause:** Native bundle capture carried package root and ID only. Hook dispatch injected only root aliases, component substitution omitted data aliases, and the durable registry stored no data epoch or readers.
- **Fix:** Capture trusted enabled snapshots and data epochs under the canonical PluginStore lock. Record exact directory identity and random reader tokens. Location disposal releases readers after dependent consumers settle. Default uninstall persists retirement before cleanup; new installs cannot revive a retired epoch. Explicit keep-data preserves it. Cleanup refuses changed directory ownership and retains unknown/crashed readers. Public catalog results report deferred cleanup, and Plugins UI/CLI display it.

## Reproduction and verification

From `packages/apexo`, run `bun test --timeout 30000 test/v2/plugin-data-native.test.ts test/v2/plugin-bundle-runtime.test.ts test/plugin/store.test.ts`. The valid unchanged-source negative control failed one assertion with both aliases equal to `/forged`. The final native focused gate passes 19 tests and 98 assertions, including real child processes, process restart persistence, concurrent captured readers, Location disposal, package update, disable/enable, both uninstall modes, fresh epochs after retirement, substitution, and symlink/directory replacement refusal.

`bun script/grok-plugin-data-native.mjs cli` passes five checks with six provider calls through real native API routes. `bun script/grok-plugin-data-command.mjs` passes four actual CLI command checks, including `--keep-data`, unleased default deletion, and the deferred-cleanup stderr message. `bun script/grok-plugin-data-tui.mjs cli` passes seven real terminal checks with zero provider calls, including the keep-data choice reaching the backend and the deferred-cleanup notice becoming visible.

Canonical Client and legacy JavaScript SDK generation completed successfully. Core, Apexo, App, and TUI package typechecks passed. The final added-test Apexo typecheck and final App/TUI typechecks also passed. The composed shared gate passes the same 19 tests / 98 assertions. The unified rebuilt Desktop backend passes five checks / six provider calls. Actual native windows in English, Simplified Chinese and Traditional Chinese each pass eight checks with zero management-induced provider calls, including keep-data selection, deferred cleanup and notice removal after the catalog omits the field. The corrected locale-aware fixture is recorded separately under BUG088.

The pinned source and isolated installed runtime comparison passed seven checks with twelve provider requests: authoritative root/data aliases, writable data, fresh-process persistence, disable, enable, keep-data uninstall, and default deletion. Apexo deliberately defers deletion where readers or filesystem ownership are uncertain. Coordinator PID death is not positive evidence that plugin child processes stopped using data.

## Superseded fixture attempts

The first attempted negative control printed plain text, which HookDispatch intentionally treats as informational rather than structured output. Its empty result was not valid missing-data proof. The corrected JSON-output control is the accepted failing-before result. Initial auxiliary fixtures also lacked any supported plugin component and were correctly rejected; they now include a real command component.

The first child-process probe inherited an uninitialized lock location rather than the parent's scoped lock path and failed with a filesystem permission error. It now supplies the same captured scoped Flock state, without changing production locking. The first combined run also lacked local socket permission for an existing HTTP-hook fixture; the authorized isolated rerun passed.

The first native CLI probe used the shell fixture's legacy `directory` query for a native Location endpoint, reloading a different Location. It now constructs `location[directory]` using URLSearchParams, as the existing native Plugins acceptance does. This is not the double-query-delimiter root cause of BUG112.

The first terminal probe timed out after reapply. Its readiness predicate could accept the previous active label before the requested new generation settled. The fixture now checks both the new backend generation and its rendered terminal generation, following [RULE-20261015-015](../../rules/terminal-action-readiness.md). Two subsequent backend-readiness timeouts remain unattributed: the retained backend log eventually reported listening, and no product timeout or readiness code was changed. Later passing runs do not establish those timeouts' causes or fixes; no additional recurrence is counted without a held-response causal proof.

## UI optional-field settlement

Solid catalog updates originally merged nested objects, which could retain a previously displayed `retainedData` field after the next response omitted it. App and terminal catalog publication now use the existing `reconcile` operation. A real independent native process holds a reader while uninstall publishes the notice, then explicitly releases it; the next native catalog omits the field. The final terminal probe verifies that the previously visible notice disappears after refresh. The Desktop probe includes the same transition for the composed-build acceptance.
