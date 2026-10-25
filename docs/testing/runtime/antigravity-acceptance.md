# Antigravity acceptance defects

## BUG-20261025-001 — Native sessions cannot resolve a working Antigravity model

- Status: fixed; regression verification recorded below. GitHub: [#147](https://github.com/cluster1900/apexo-code/issues/147).
- Affected scope: primary CLI native headless sessions, preview CLI V2 session API, and Desktop workflows.
- Baseline: a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2, macOS 26.6.2 arm64, Bun 1.3.14, agy 1.4.7.
- Discovery: default CLI text, file editing, shell verification and same-session continuation pass with the real native account. Changing to native transport fails.
- Reproduction: sign in with agy; use isolated XDG directories; run `models antigravity`, then `run --model antigravity/gemini-3.8-flash --variant low --format json "Reply OK. No tools."` from packages/apexo. Repeat with `--session-protocol native`. The linked issue includes complete setup and commands.
- Observed: catalog and default request succeed; native request exits 1 with `Model unavailable: antigravity/gemini-3.8-flash` and failed input execution. The native suffixed model ID fails too. A preview CLI create/prompt/wait flow also admits the prompt and then surfaces the same unavailable error.
- Expected: an authenticated advertised model resolves and executes through native sessions as well as the default path.
- Root cause: plugin boot batches integration transforms. External authentication ran before the registered auth method was materialized, and its failure was ignored, leaving no usable native connection.
- Fix: reload integrations after registering the Antigravity method and before attempting external authentication. The regression invokes the plugin inside `State.batch`, matching production boot.
- Verification: two canonical-ID native reproductions (coding and text-only), one native-alias reproduction and one preview API reproduction fail. Default Low/High requests and two-turn file/test oracles pass. Desktop deep-research validation succeeds, but Start fails at plan stage with the same ModelUnavailableError (one child admitted, zero tokens). Main Desktop conversation and Side question pass with the same model. This is not the silent execution failure from historical #119.

## BUG-20261025-002 — Invalid reasoning variants silently run provider work

- Status: fixed; regression verification recorded below. GitHub: [#148](https://github.com/cluster1900/apexo-code/issues/148).
- Affected scope: primary CLI Antigravity variant validation.
- Baseline/environment: same as BUG-20261025-001.
- Reproduction: with a working agy account, run `bun run src/index.ts run --model antigravity/gemini-3.8-flash --variant definitely-invalid --format json "Reply INVALID_VARIANT_ACCEPTED. No tools."` from packages/apexo. Repeat with `--variant typo-effort`.
- Observed: both exit 0 with the requested assistant text and successful provider usage. No warning identifies the unsupported variant. The first request used 8,810 input tokens and 5 output tokens.
- Expected: reject the unsupported nonempty variant before inference and list valid choices, or explicitly report an intentional fallback.
- Root cause: the compatibility LLM path looked up the variant options without rejecting an unknown key, so inference proceeded with fallback options.
- Fix: reject unsupported explicit non-default variants before language/provider setup, with the valid choices in the error. Variant membership uses own properties, so inherited names such as `toString` cannot bypass validation. Small-model housekeeping calls retain their separate model selection.
- Verification: two invalid strings reproduce; valid Low/High controls pass; invalid model IDs fail with an actionable error.

These are independent symptoms, not a claim of recurring identical root causes. No new recurring constraint is promoted.

## BUG-20261025-003 — Fork waits silently after a session changes directory

- Status: fixed; regression verification recorded below. GitHub: [#149](https://github.com/cluster1900/apexo-code/issues/149).
- Scope: primary CLI session import and fork. Baseline/environment: same as BUG-20261025-001.
- Discovery and reproduction: create a live session in disposable directory A; export it; import from directory B; run `run --dir "$A" --session "$SID" --fork --model antigravity/gemini-3.8-flash --variant low --format json "Reply OK. No tools." </dev/null`. The issue gives full setup.
- Observed: no stdout/stderr before 45–90 second external time limits. Repeated with a coding session, a text-only session, and closed stdin. Using directory B succeeds in 8.68 seconds; never-imported session fork also succeeds.
- Expected: adopt the existing placement or report the directory mismatch promptly.
- Root cause: fork accepted a directory that did not own the existing session and then waited for downstream events. The precise original downstream waiting path remains unconfirmed. Import intentionally updating placement is not classified as a defect.
- Fix: preflight the existing session directory before forking and return the correct `--dir` when it differs. Local paths are canonicalized; attached-server paths preserve remote spelling.
- Regression: a real export/import from A to B followed by fork in A now exits 1 in 3.8 seconds with actionable guidance; fork in B completes in 6.36 seconds. A real subprocess regression asserts one original provider request and no extra request from the rejected fork.

## BUG-20261025-007 — Goal corrective turn repeatedly returns HTTP 400

- Status: fixed; regression verification recorded below. GitHub: [#153](https://github.com/cluster1900/apexo-code/issues/153).
- Scope: Desktop Goal worker continuation with Antigravity, plus final-step request reminders in compatibility and native execution. Environment: same baseline/model, actual Electron and Node sidecar.
- Discovery/reproduction: fork a successful coding conversation; create a 20000-token text-only Goal and reach budget exhaustion; clear it while preserving messages; create a new exact-marker Goal with 200000 tokens; pause/resume planning and approve private plan writes; resume after a review failure. The worker emits both the earlier and new marker. Evaluation correctly requests only the new marker. The corrective worker then returns HTTP 400. Explicit Resume repeats that error in approximately 1.16 seconds. Full sequence and caveats are in the issue.
- Observed: infrastructure-paused at 166106 / 200000 tokens, usage incomplete; APIError statusCode=400, isRetryable=false, generic instruction to check the account.
- Expected: valid corrective work continues, or the rejected request is diagnosed sufficiently to distinguish it from account configuration.
- Root cause: after independent review rejected completion, the worker history still ended with an assistant response. Updating only system guidance did not start a new turn. At the agent step limit, the final-step reminder also appended an assistant message after the corrective user message, reproducing the same rejected shape. A minimal real Antigravity request with that shape returns HTTP 400 with `Requests ending with a model turn are not supported.`
- Fix: add the current Goal guidance as a transient user turn when continuing after an assistant response. Make the final-step reminder a user message in both compatibility and Core native execution, including when correction and the step limit coincide. Keep durable user history unchanged. HTTP 400 guidance now describes a rejected request rather than implying an account problem.
- Regression: the real-provider paired request succeeds with the corrective user turn and returns the requested marker. The full Goal rejection/continuation integration test runs with both unlimited steps and a one-step worker. The limited case reproduced an assistant-ending corrective request before the final-step fix; both cases then pass (2 tests, 18 assertions), asserting two worker calls and one durable user message. A real Gemini CLI run with `steps: 1` exits 0 in 7.13 seconds and returns `CLI_LAST_STEP_OK` with the step-limit summary. The native one-step control independently reproduced HTTP 400 in 6.52 seconds before the Core reminder fix; afterward it returns `NATIVE_LAST_STEP_OK` in 6.87 seconds and settles with the existing `turn_limit` outcome (exit 1, complete usage), without a provider error. The native subprocess test verifies the provider receives a final user reminder and the turn-limit result remains intact. A real Desktop Goal also returns `WRONG_ON_PURPOSE`, receives a rejecting review, and then returns `GOAL_CORRECTED_OK` in a second successful worker turn. A separate lifecycle run reaches Verified complete with all three independent reports. Details are recorded in the linked regression report.

## Fix regression evidence

See [the fix run](../desktop-cli/2026-10-25-regression.md) for the complete gates and live evidence. Original observations above remain the pre-fix baseline.

- #147: native text and read/write/shell coding calls pass; preview create/prompt/wait/messages returns `PREVIEW_GEMINI_OK`. The batched-plugin regression also verifies an available catalog model.
- #148: real `typo-effort` exits 1 in 2.87 seconds and lists default/low/medium/high; Low and High succeed. The subprocess regressions confirm zero provider hits for both an ordinary typo and inherited `toString`. The latter initially reproduced exit 0 before the own-property guard was added. Native execution already validates variants through `SessionRunnerModel.withVariant`; real `typo-effort` and `toString` controls exit 1, and native subprocess tests assert the specific variant error plus zero provider requests.
- #149: mismatched and matching placement controls pass as described above.
- #153: real-provider protocol comparison and actual Goal execution are distinguished from the deterministic review-rejection integration test; no provider outage or account issue is inferred.
