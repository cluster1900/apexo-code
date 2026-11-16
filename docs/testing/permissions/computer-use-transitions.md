# Computer Use native permission transitions

## BUG-20261116-015: First Desktop screenshot failed after grants were enabled

- Scope: upstream 1.3.1 through the actual installed plugin, packaged V2 Desktop copy on macOS arm64. No production fix is claimed.
- Observed: both native permission reports were granted and the document snapshot worked, but screenshot returned `INTERNAL`, `screencapture exited with error`, with platform detail `could not create image from window`.
- Expected: a screenshot of the freshly selected visible fixture window should return an inline PNG after the launching identity has the required grants.
- Reproduction: start a separately signed packaged Desktop copy with both grants absent, grant Accessibility and then Screen Recording manually, and request the fixture screenshot without first restarting the whole native launch chain. The symptom was observed once; deterministic reproduction has not been established.
- Root cause: unknown. The transcript does not establish whether the OS transition, a process's cached state, or another native capture condition caused the error. The user-triggered OS relaunch also dropped the Desktop fixture's environment once; that is a separate setup issue.
- Recovery evaluated: stop only the owned test app/daemon, launch the same signed copy with the isolated V2 configuration again, take a fresh target observation, and issue a new screenshot request. No mutation was repeated.
- Verification: the controlled relaunch returned granted/granted, the exact snapshot marker, and an inline PNG. Earlier denied/denied and Accessibility-only states produced the expected `PERM_DENIED` errors; Accessibility-only still allowed the document snapshot. These passing cases verify those specific outcomes, not a root-cause repair or all launch identities. See the [dated evidence](../../development/computer-use-permission-transitions.md).

## BUG-20261116-016: Permission fixture lifecycle and attribution assumptions

- Scope: manual OS-permission acceptance harness, not a product permission-parser change.
- Observed: changing the copied Electron app's internal `CFBundleName` made it fail to find its helper. Another attempt required an optional health PID field and failed cleanup before owning the daemon PID. A fixture document was closed during manual setup, invalidating the captured window ID. The CLI helper exited during manual setup, and its controller timed out; after restart both grants were on, so an Accessibility-only assertion failed. A distinct CLI bundle name did not appear in the final OS permission lists.
- Expected: retain Electron's internal helper lookup name, track exact owned processes, re-observe targets, reconnect after manual OS lifecycle changes, and accept only the actual observed permission combination and ownership evidence.
- Root causes: confirmed fixture assumptions about Electron naming, optional Client fields, stale target identity, and expected OS state. Why the CLI helper exited and the precise CLI grant attribution remain unknown. A unique bundle ID is not sufficient proof of independent TCC ownership.
- Fixes: preserve the internal Electron name while changing its display/signing identity; identify owned daemon PIDs from exact private launch paths; reopen the owned fixture and discover its window again. The dedicated CLI harness stores launch arguments inside its temporary app, supports controller resume, publishes JSON commands/results atomically, retains phase receipts, and requires a new explicit phase after restart.
- Verification: packaged Desktop denied/Accessibility-only/granted cases completed, with the earlier native capture failure retained under BUG-20261116-015. CLI denied and granted stages completed, including a final revised-harness PNG-signature check and controlled finish. CLI Accessibility-only and its exact grant attribution remain unaccepted. No production code, existing grant, or TCC database was changed by the fixture.
