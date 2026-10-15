# Explicit Session restoration and future schedules

The reviewed implementation is integrated into the shared branch and adds a bodyless `POST /api/session/:sessionID/restore` control. It resolves the existing Session through its recorded Location and the process-global Session execution coordinator. It does not admit a prompt, drain a provider turn, promote queued inputs, approve permissions, or replay an interrupted child.

Eligible retained schedules resume at a strictly future cadence boundary. A deadline already in the future is retained; missed ticks advance by whole intervals. Repeating restoration does not slide that deadline. Both values of the durable option can retain intent. Manual pauses and accepted Stop remain paused, and expiry and deletion remain terminal. Ordinary owner teardown records `restart_required` after joined cleanup rather than recording a user Stop.

Restoration rechecks Session Created identity, schedule revision and generation, owner epoch, Goal, pending Plan and canonical headless-input state after asynchronous model resolution. Permission `ask` produces `permission_required`; the existing explicit Resume schedule action owns any consent request. Accepted Stop during restoration joins the control and fences only its exact unchanged candidate snapshots. A concurrent manual pause, deletion or newer revision wins. Retirement does not use that Stop path.

A foreign unfinished occurrence with unproven ownership produces `unfinished_owner`. Its occurrence and Task receipts remain unchanged, and no new occurrence overlaps it. This conservative boundary is not full active-process crash recovery. A strict dead-owner lease is a separate design proposal, not part of this implementation.

## Explicit client actions

App restoration is attached to actual Session tab/sidebar/keyboard selection and explicit project opening that selects a Session. The selected server client and Session ID are captured at the action boundary. Automatic neighbor selection, persisted-tab hydration, prefetch, history reads, route effects and reconnect remain passive. The existing Tasks dialog also offers an explicit Restore schedules action for a Session reached passively.

Fullscreen restoration occurs on explicit existing-Session arguments, Continue and Session picker selection. Mini restoration occurs only after explicit existing-Session or Continue resolution. A mini startup notice is a display-only local scrollback row, inserted after replay; it is not a user input or model message. Headless entrypoints never call restoration.

## Localization review

New App copy uses typed `session.restore.*` keys in English, Simplified Chinese and Traditional Chinese. Existing English values are unchanged; other locales use the typed English fallback for these new keys. The established 定时任务 / 排程任務 labels are retained. The maintained Firefox [Simplified Chinese session restoration corpus](https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/zh-CN/browser/browser/aboutSessionRestore.ftl) and [Traditional Chinese corpus](https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/zh-TW/browser/browser/aboutSessionRestore.ftl) inform 恢复 / 回復. Microsoft [Simplified Chinese Task Scheduler documentation](https://learn.microsoft.com/zh-cn/windows/win32/taskschd/task-scheduler-start-page) and [Traditional Chinese documentation](https://learn.microsoft.com/zh-tw/windows/win32/taskschd/task-scheduler-start-page) provide schedule terminology context. Existing pause/permission wording follows the [Scheduler management review](native-scheduler-ui-localization.md), including its language-authority usage evidence.

Phrases describe future execution and retained pauses without promising arbitrary crash recovery. These are corpus-reviewed drafts, not native-speaker signoff. Terminal copy follows its existing English presentation convention. Placeholder checks passed, and English/Simplified Chinese/Traditional Chinese outcomes were rendered and inspected in the production browser and an actual isolated native Desktop window. Both the eligible and permission-required outcomes remained readable with their controls.

## Reference boundary

The isolated installed 1.0.52 same-Session comparison recorded on 2026-10-15 is retained: `bun script/grok-scheduler-session-restart-official.mjs omitted` passed four observations with 15 provider requests, including a real 60-second future occurrence after process kill and Session load. See the [same-Session restart evidence](native-scheduler.md#same-session-restart-correction). This restoration slice uses that explicit-load behavior as its reference; it does not claim a new installed run for the UI wiring.

Apexo keeps passive reads and hydration separate from explicit adoption and does not replay interrupted provider work. Unknown foreign unfinished ownership remains blocked, permission asks remain explicit, and user Stop/manual pauses remain authoritative. These are stated boundaries rather than claims of identical crash recovery.

## Verification status

The isolated focused batch passed 18 tests and 181 assertions across store, owner, runtime, held-authority races and cold native HTTP. It includes zero-provider allow/ask/deny restoration, manual/Stop preservation, joined retirement, Stop during model resolution for current and foreign owners, late Goal/Plan/headless/policy changes, joined Session deletion, managed empty no-op and wrong-Location rejection.

Run from `packages/apexo`:

```sh
bun test test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts
```

Private Client and legacy SDK generation passed. Core, App, TUI, Protocol, Server and Apexo package types passed after the typed fixture correction. App adapter and locale checks passed three tests / 292 assertions, including real native HTTP target capture, compatibility no-op, safe errors and owner cancellation.

The real source CLI and rebuilt packaged Desktop restart/recurrence fixtures each passed four checks with 11 provider calls. It proves passive post-restart reads do not replay work, explicit restoration retains a future deadline without sliding it, manual/Stop pauses remain paused, unknown unfinished ownership stays blocked, and a real future tick uses the existing Task execution path. Private App and Desktop production builds passed. The production browser and actual native Desktop window each passed four checks in the eligible branch and four in the permission-required branch, with five setup provider calls per branch and no additional provider calls during restoration. Each branch rendered English, Simplified Chinese and Traditional Chinese. Direct route hydration and passive manager reads sent no restore request; explicit tab activation and the existing manager action sent bodyless requests. Repeated restoration retained the future deadline, and later manual pauses remained paused.

Actual mini and fullscreen terminals at 80×24 each passed five checks: explicit attachment restored once, existing future-only pause/resume/delete controls retained Task separation, and `/loop` continued through ordinary prompt admission. Each run used five setup calls and two deliberate `/loop` calls; passive management and restoration added none. Each mode also passed a separate permission-required check: attachment displayed the safe notice without asking, then explicit Resume opened real consent and approval armed the future intent with no model work. Terminal frames and native screenshots were inspected; every owned process was reaped.

Reproduce from `packages/apexo`:

```sh
bun script/grok-scheduler-restore-native.mjs cli
bun script/grok-scheduler-restore-native.mjs desktop
bun script/grok-native-scheduler-ui.mjs browser --restoration --locales
bun script/grok-native-scheduler-ui.mjs browser --restoration --permission --locales
bun script/grok-native-scheduler-ui.mjs native --restoration --locales
bun script/grok-native-scheduler-ui.mjs native --restoration --permission --locales
bun script/grok-native-scheduler-tui.mjs --narrow
bun script/grok-native-scheduler-tui.mjs --fullscreen --narrow
bun script/grok-native-scheduler-tui.mjs --permission --narrow
bun script/grok-native-scheduler-tui.mjs --fullscreen --permission --narrow
```

The [fixed-backend paired measurement](testing/performance/native-scheduler-restoration-composer.md) completed: median 121 → 114.5 ms, p95 126 → 133 ms, zero Long Tasks. Raw samples and limits are retained; no causal claim is made.

## Shared integration checkpoint

The exact 41-file handoff was reviewed and integrated after checking original/final hashes. The shared five-file gate above passes 18 tests/181 assertions with `--timeout 30000`. The shared App adapter/localization gate passes three tests/292 assertions with `bun test --conditions=solid --preload ./happydom.ts src/utils/session-restore.test.ts src/i18n/scheduler.test.ts` from `packages/app`. Client and legacy SDK generation pass after composing restoration with native Memory recovery and exact retry. All 21 workspace types and isolated-index generated consistency pass. Fresh shared App/Desktop builds and the runtime acceptance below verify the integrated composition; the private results above are retained separately.

The shared source CLI and freshly rebuilt packaged Desktop each now pass four checks/eleven provider calls, including actual process kill/reopen and a real future cadence tick. The shared production browser passes four restoration checks across English/Simplified Chinese/Traditional Chinese with five setup calls and no restoration-induced model work. The complete HTTP gate is still running, and a fresh whole-repository unit gate remains required.

Shared interactive acceptance is now complete for this slice. The production browser and actual isolated native Desktop window each pass four checks in both eligible and permission-required branches, with en/zh/zht screenshots inspected. Each branch uses five setup provider calls and none for restoration. Real mini/fullscreen terminals at 80×24 each pass five ordinary checks (five setup calls, two explicit `/loop` calls, no passive calls) and one permission-consent check (five setup calls, zero action-induced calls). Terminal frames were inspected and every owned process was reaped. These shared checks supplement the documented installed same-Session restoration comparison; they do not claim arbitrary foreign-owner crash recovery or cross-platform acceptance.
