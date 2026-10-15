# Native Goal closing summary

After independent verification persists `complete`, the native Goal runner may
produce one optional closing summary. Apexo owns its durable claim, child
Session, model execution, usage receipts, cancellation and recovery. No product
path invokes the Grok executable.

`goal.summary_enabled` defaults to true. `GROK_GOAL_SUMMARY` takes precedence,
including explicit false and the shared trimmed, case-insensitive boolean
spellings. An invalid environment value falls back to configuration. Existing
CLI strategy and lifecycle fixtures explicitly disable summaries when their
purpose is the earlier role contract; the native lifecycle integration and the
dedicated summary acceptance exercise the default-on path.

## Ownership and completion

The verifier commits completion before summary configuration, child creation or
provider work. Core claims the summary once per Goal lifetime in the durable
attempt ledger. The claim grants a distinct terminal capability; it cannot pass
ordinary active-worker checks, reopen the Goal, modify the acceptance plan or
perform another verification round. Disabled, exhausted-budget and unknown-usage
claims settle without model work. Reading an old completed Goal never creates a
new summary, including Goals completed before this feature existed.

The summary runs through the native Session runner using the parent's selected
model and agent. Its permissions deny all tools, its request exposes no tools,
and its live capability permits one drain only. The child receives the original
objective and bounded copies of the plan, verification results and projected
worker evidence. It cannot inspect more files or execute commands. This is an
explicit Apexo adaptation of the reference's read-only inspecting child. The
summary must use only that evidence, preserve caveats, and give usage steps only
when the evidence supports them. Output is capped at 1200 Unicode code points.

The child has its own durable input. There is no synthetic visible parent user
prompt. Queued prompts, advisory wakes and later explicit resumes of the managed
child cannot issue another summary request. Persisted child metadata rejects
execution after its live owner capability has closed. Manual compaction of the
child is unavailable because its owner must read the final projected reply after
the drain. The runner skips automatic compaction and overflow retries for this
single-turn child.

A valid result requires a clean stop receipt, complete transport usage, nonempty
assistant text and no attempted tool call. Length termination, missing terminal
receipts, provider errors and forbidden tools cannot produce successful summary
text. The Goal remains complete through every result. Completion UI may therefore
show a running summary before its text appears.

## Budget, cancellation and restart

Before the one provider request, the terminal usage wrapper rechecks the durable
claim, remaining budget and known usage. Actual transport receipts use the
existing deduplicating ledger and update both Goal and summary token counts. A
request can overshoot its remaining budget: a fixture completed verification at
840 tokens with an 850-token limit, then reported a 120-token summary. Its final
state remains complete at 960 actual tokens. No second request is allowed.

Cancellation records an interrupted summary; missing receipts retain
`usageIncomplete`. Late valid receipts may increase the original Goal's usage,
but cannot rewrite settled text. Clearing or replacing the Goal invalidates
ownership so late output cannot attach to its replacement.

A crash leaves the durable summary claim running. The existing maintenance
service reconciles it only after the stored local process owner is verified dead,
then records failed/interrupted with unknown usage. It never retries a model
request or reopens the completed Goal. State reads stay read-only. Live,
inaccessible or reused process IDs are conservatively protected; elapsed time is
not evidence of dead ownership.

## Public state

`Goal.Info.summary` is optional. Its status is running, completed, failed or
skipped. It may include the native child Session ID, bounded text, actual model,
summary tokens, timestamps and a reason: disabled, budget, interrupted, provider,
output, usage or execution. A missing field on an older Goal does not imply a
pending request. Existing Goal status and phase vocabulary is unchanged.

## Verification

Commands use pinned Bun 1.3.14 from `packages/apexo` unless stated otherwise:

- `bun test test/session/goal.test.ts test/session/goal-cleanup.test.ts test/effect/runtime-flags.test.ts`:
  durable claims, worker authority separation, deduplicated and late receipts,
  post-claim quota changes, cancellation, replacement, dead-owner reconciliation
  and configuration precedence: 121 tests and 721 assertions passed.
- `bun test test/e2e/v2-goal.e2e.test.ts`: default-on full native lifecycle passed
  one test and 39 assertions, including summary tools, usage, queued work and
  unchanged parent user-message count.
- `bun script/grok-goal-summary.mjs cli`: ten scenarios and 80 actual provider
  requests passed. Each Goal issued exactly one summary request. Scenarios cover
  successful output, budget overshoot, length termination, missing terminal
  receipt, provider failure, forbidden tool, held child with concurrent prompt,
  cancellation, clear/replacement and SIGKILL/reopen without retry.
- Core and Apexo package `bun typecheck` passed after fixture type corrections.
- `bun script/grok-goal-summary.mjs desktop`: the freshly built production backend
  passed the same ten scenarios and 80 provider requests, including SIGKILL/reopen
  and one-use child replay checks. All fixture-owned processes were closed.

The isolated installed Grok 1.0.52 comparison
`bun script/grok-goal-summary-official.mjs` passed two scenarios with 24 requests,
including reference title work. Each completed Goal requested one Goal Summarizer
child. Empty output preserved completion and the installed runtime surfaced a
generic child-success fallback; Apexo instead records failed/output. The pinned
source reference is `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, particularly
`goal_summarizer.rs` and `templates/goal_summarizer_prompt.md`. These observations
are comparison evidence, not tests of Apexo's implementation.


## App and terminal acceptance

The production App renders pending summary work separately from the already
completed Goal, then displays the bounded result. Unknown usage and other failed
optional summaries keep the completed Goal visible. Disabled summaries stay
hidden. The shared terminal panel has the same states and selects native Goal
routes for native-only servers. Closing or reopening a panel does not request a
new summary.

- `bun script/grok-native-goal-tui.mjs` and its `--fullscreen` variant each passed
  seven checks against the real native-only source server. These exercise the
  production panel in compact and expanded PTYs, not full native-only terminal
  bootstrap. Checks include cancelled initial protocol-probe recovery, controls,
  cancelled usage, pending/completed summary, report navigation and clear.
- `bun script/grok-goal-tui.mjs` and its `--fullscreen` variant passed the actual
  compatibility mini and fullscreen terminal flows after shared adapter changes.
- `bun script/grok-native-goal-ui.mjs desktop --locales` passed eleven checks
  against the native-only source server and production App assets, including
  pause/resume, independently verified completion, unknown-usage rejection,
  summary progress/output, reopening, Simplified/Traditional Chinese labels, and
  report preview/download/cleanup. The screenshots were inspected.
- `bun script/grok-native-goal-ui.mjs native --locales` passed the same eleven
  checks in a real macOS Electron window after the coordinated Desktop build.
  Simplified/Traditional Chinese summary screenshots were inspected. The final
  fixture waits for rendered worker state and stable enabled hit targets before
  acting; earlier missed-click symptoms are tracked separately in BUG-017.
- App, TUI and Server package typechecks passed after public-client generation.

New visible App copy uses typed translation keys. Summary terminology was checked
against the maintained [VS Code Simplified Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json),
[Firefox Simplified Chinese AI corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/genai.ftl),
[VS Code Traditional Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hant/translations/main.i18n.json),
[Firefox Traditional Chinese AI corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/genai.ftl)
and the [Taiwan Ministry of Education definition of 摘要](https://dict.concised.moe.edu.tw/dictView.jsp?ID=29567&q=1).
Existing project terminology and placeholders are preserved. The two Chinese
rendered panels were inspected; this is not native-speaker certification. Other
locales keep the existing English fallback for these new Goal keys. The terminal
retains its established English interface.

Before editing Session UI, the production composer benchmark measured a 114.5 ms
median and 123 ms p95. With the same unchanged packaged backend, the new App build
measured 117/154 ms; a repeat prompted by the tail increase measured 121.5/145 ms.
Each run used ten browser-clock samples, discarding the first two, from reload
request to the first visible composer animation frame. Other agents paused CPU
and browser work during these measurements. The recorded tail increased by
22–31 ms and the median by 2.5–7 ms; these small local samples do not establish
absence of a performance regression or cross-platform performance. The subsequent
Plugins-only RTL CSS correction does not change Session/composer code.
