# Native command sandbox controls

The App exposes Command sandbox beside the existing Session controls. Before a native Session is created, users can choose Off, Workspace, or Read-only. Each new draft defaults to Off. The first submitted prompt stores the selection through the existing native creation endpoint. A failed selected creation displays the backend error and retains the selection; it never retries as Off.

Existing Sessions show passive, immutable status with explicit refresh. Stored profile, backend availability and the latest execution receipt are distinct. Merely opening the panel does not probe a launcher, run a command, or call a model. The copy states that this policy covers native commands on macOS, not all agent activity, and discloses existing hard-link and external-writer limitations. It does not claim whole-agent filesystem protection.

Selection is available only for a native App connection. Compatibility connections show an unavailable explanation. Terminal `/sandbox` is passive in mini and fullscreen modes: the terminal still creates and executes through compatibility routes, so it does not offer a selection that would create a Session it cannot execute. Opening it without a Session does not create one. Native CLI bootstrap/execution remains separate G07 work; whole-agent sandbox parity remains open.

## Client boundary

The App's vendored promise client predates command-sandbox creation and the nested native prompt envelope. Selected creation and native prompt admission use the current generated v2 SDK, with no casts or vendor/generated edits. Off creation and compatibility execution retain their previous paths. Prompt IDs, delivery, admit-only controls and attachments are preserved. See [BUG086](testing/types/app-sandbox-client-shape.md) and [BUG090](testing/ui/native-prompt-envelope.md).

## Localization

App copy is reviewed for en, zh and zht. Terms reuse the application's Session/workspace terminology; zh uses 命令/只读/沙盒 and zht uses 指令/唯讀/沙盒. References include the [Microsoft Simplified Chinese Windows Sandbox documentation](https://learn.microsoft.com/zh-cn/windows/security/application-security/application-isolation/windows-sandbox), its [ReadOnly configuration guidance](https://learn.microsoft.com/zh-cn/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file), and [Apple Traditional Chinese runtime-security guidance](https://support.apple.com/zh-tw/guide/security/sec15bfe098e/web). Cross-checks include [Mozilla’s Simplified Chinese sandbox terminology](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox), [Traditional Chinese read-only usage](https://developer.mozilla.org/zh-TW/docs/Web/API/Document/execCommand), and the [Taiwan Ministry of Education definition of 唯讀](https://dict.revised.moe.edu.tw/dictView.jsp?ID=160912). The differing command terms 命令/指令 follow existing regional UI usage; further native-speaker phrasing review remains welcome. Other App locales currently use the existing English fallback for these new keys. The terminal follows the existing English-only feature-control scope; this change does not introduce terminal localization.

## Verification

- Private App typecheck/build passed; TUI typecheck passed.
- App transport checks: 3 tests / 18 assertions, including a real HTTP socket, authorization, exact prompt envelope, attachment mentions, queue, admit-only and error propagation.
- Browser: seven checks across en/zh/zht, exactly three ordinary model calls for all profiles; passive status, immutable profile, visible status failure and selected-create failure without fallback.
- Real narrow terminal component PTYs: mini and fullscreen each pass three checks with zero provider calls, including refresh failure and recovery.
- Actual mini/fullscreen no-Session CLI slash-route checks each pass three checks with zero provider calls. Fullscreen stays on Home without a Session; mini attach may create its ordinary off Session during bootstrap, and opening the panel creates no additional Session. Shared native-window validation is recorded below. No claim is made from a stale Desktop renderer.

The reference/backend enforcement comparison is documented separately in [Native command sandbox](native-command-sandbox.md). These UI checks exercise Apexo's own Session/API/model flow and do not invoke Grok.


## Shared integration checkpoint

The source is integrated. All 21 repository typecheck tasks and the production App build passed. Live App transport tests passed three tests / 18 assertions. The live production browser passed seven checks / three provider calls; actual mini and fullscreen slash routes each passed three checks with zero provider calls. The final paired composer observation is [recorded separately](testing/performance/command-sandbox-composer.md), including the measured increase. The actual rebuilt native-window run passed seven checks / three calls across en/zh/zht. Its screenshot exposed the duplicate creation-error toast; the narrow repair then passed a corrected before/after regression and the same native-window acceptance. See [BUG095](testing/ui/session-create-duplicate-toast.md). The repaired-artifact performance follow-up measured 112.5 ms median / 118 ms p95 against the same preserved backend, versus 122 / 126 ms before the repair; compatibility selection-disabled behavior is source/type reviewed but has no dedicated actual-window acceptance yet.

## Compatibility-control acceptance

The extended `grok-native-sandbox-ui.mjs` fixture now verifies a separately registered compatibility server after native creation. Production browser and actual rebuilt native Desktop each passed eight checks / three native-provider calls with `--locales --compat-control`. Compatibility controls retained Off, disabled all three choices, showed their localized explanation, and made no compatibility Session or provider work. Traditional Chinese screenshots were inspected in both surfaces. The initial browser setup omitted connection registration and routed the compatibility ID to the native default; [BUG107](testing/test-fixtures/sandbox-compatibility-server-registration.md) records the fixture correction and evidence without claiming a product protocol repair.
