# Native Memory management UI

Status: integrated and accepted for the scoped management UI. Shared App adapters passed six tests / 28 assertions; App, TUI and Apexo types and production App/Desktop builds passed. Production browser and actual rebuilt Desktop windows each passed eighteen checks across en/zh/zht. Actual mini/fullscreen acceptance passed twenty-four checks, including explicit native selection against the packaged mixed Desktop backend. Advanced Memory lifecycle remains outside this slice.

Apexo's existing Memory browser now uses the selected Session transport. Native App and terminal management supports status, enable/disable, passive catalog/search, preview and deletion of one reviewed note by its exact hash. Compatibility management retains its existing routes and controls. A native request failure never falls back to compatibility.

Native mode starts disabled according to the server's existing policy. Opening the browser does not enable Memory, migrate notes, extract memories or start a model turn. Disabling hides cached note content and keeps saved files. The server remains authoritative for mode, backend, permissions, catalog containment and generation/incarnation fences; the UI's busy indication is advisory and does not promise queued enablement.

The App uses the directory SDK's protocol selection. Fullscreen uses the cached `sdk.transport()` choice and mini uses bootstrap's `ctx.native`. These adapters do not infer authority from Session IDs or editable metadata. Managed children have no added Memory controls, and actual native status refuses management without exposing note content. Existing authorized transcript text is preserved; disabling Memory does not erase history.

Known unsupported native operations are visible as unsupported commands and consumed locally. Native health, review, capture, flush, Dream and background maintenance never invoke compatibility endpoints. In the App, `/memory` requires an existing Session; an unsupported operation or attached-input command receives fixed guidance before model selection or Session creation. Exact first-token matching leaves unrelated commands alone.

The App and terminal browser discard late requests after cancellation. Failed status or mode changes clear stale details; disabling during a held preview cannot restore its content. Forget uses the last preview's hash and a separate confirmation. A conflict clears that preview and confirmation, requiring refresh and a new review; there is no automatic deletion retry. HTTP failures map to fixed safe messages instead of displaying arbitrary server causes.

## Validation boundary

This slice contains presentation and typed adapters only. Native backend, CLI bootstrap and installed-reference results remain separately documented in [Native Memory tools](native-memory-tools.md). The existing reference comparison verified exposed catalogs and passive behavior; it did not establish a matching official management UI. No Grok executable, compatibility loop or upstream test is part of the implementation.

Shared-artifact verification:

- `bun script/grok-native-memory-ui.mjs browser --locales` and `native --locales`: eighteen checks each, five fixture setup calls and zero management-induced calls. The native case runs the rebuilt Electron window against the owned native source backend; it is not described as the packaged backend case.
- `bun script/grok-native-memory-tui.mjs`, with and without `--fullscreen`: six checks each at 120×40 against the owned native source backend.
- `bun script/grok-native-memory-tui.mjs --desktop --narrow`, with and without `--fullscreen`: six checks each at 80×24 against the actual packaged mixed Desktop backend, with explicit `--session-protocol native`. These checks preserve route evidence, note hash conflicts, reconfirmation and the zero-extra-provider assertion.
- Fresh `bun script/grok-memory-native-official.mjs`: both installed configuration selections passed, with four total reference requests. This remains catalog/passive comparison evidence, not acceptance of an identical official UI.
- Captured native-window Simplified Chinese preview and Traditional Chinese hash-conflict frames were inspected. Active terminal frames show the management header, actions and note preview at both tested sizes.
- The [paired production composer comparison](testing/performance/native-memory-ui-composer.md) includes both execution orders, twenty measurements per artifact and zero Long Task entries. It does not establish a causal speed change.

Private coherent-checkpoint verification:

- App adapter: six tests, 28 assertions using actual HTTP requests; native/compatibility route selection, decoded query semantics, fixed errors and no fallback.
- Production App browser: eighteen checks across English, Simplified Chinese and Traditional Chinese. Five provider calls create the real note and managed Task fixture; management adds zero calls. Held-status and held-preview release after disable, actual same-ID server-scope navigation, hash conflict/reconfirmation and managed-child refusal use the actual native server. The status race passed with the existing request-abort behavior; no stale-status defect was confirmed. SDK identity and owner disposal now close the dialog as a review mitigation, without claiming a reproduced content leak.
- Actual mini and fullscreen CLI: six checks each at both 120×40 and 80×24 (twenty-four checks total), five setup calls per run and zero additional calls. Toggle assertions wait for the successful PATCH and resulting foreground dialog state. Active terminal frames are captured before teardown and inspected for readable preview, conflict and guidance content.
- Rebuilt private Desktop native window: eighteen checks across en/zh/zht, five setup provider calls and zero UI calls. Final screenshots were inspected for translated disabled/preview states and safe hash-conflict guidance. The actual same-ID server-scope navigation closes the dialog.
- Final App, TUI and Apexo package typechecks passed; private App/Desktop production builds passed. Shared integration, adapter tests, affected-package types and the App build have passed. The newer shared-artifact checks are listed above; private results remain separate evidence.

The [localization review](native-memory-ui-localization.md) identifies the maintained corpora used. Existing English copy is unchanged; new App copy is translated for Simplified and Traditional Chinese. Other App locales use the normal English fallback. Terminals retain their existing English contract.

## Scope limits

This slice does not implement native capture, Dream, flush, clear, rewrite, review approval or migration. It does not create a second Memory executor or grant managed-child authority. Explicit native selection on the packaged mixed server passed after composition with the Session-protocol selector. Pure-native attachment alone was not used to prove that case.
