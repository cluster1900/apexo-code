# Antigravity acceptance defects

## BUG-20261025-001 — Native sessions cannot resolve a working Antigravity model

- Status: unresolved. GitHub: [#147](https://github.com/cluster1900/apexo-code/issues/147).
- Affected scope: primary CLI native headless sessions, preview CLI V2 session API, and Desktop workflows.
- Baseline: a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2, macOS 26.6.2 arm64, Bun 1.3.14, agy 1.4.7.
- Discovery: default CLI text, file editing, shell verification and same-session continuation pass with the real native account. Changing to native transport fails.
- Reproduction: sign in with agy; use isolated XDG directories; run `models antigravity`, then `run --model antigravity/gemini-3.8-flash --variant low --format json "Reply OK. No tools."` from packages/apexo. Repeat with `--session-protocol native`. The linked issue includes complete setup and commands.
- Observed: catalog and default request succeed; native request exits 1 with `Model unavailable: antigravity/gemini-3.8-flash` and failed input execution. The native suffixed model ID fails too. A preview CLI create/prompt/wait flow also admits the prompt and then surfaces the same unavailable error.
- Expected: an authenticated advertised model resolves and executes through native sessions as well as the default path.
- Root cause: unknown. Model resolution mismatch is observed; no provider outage is inferred.
- Fix: none applied.
- Verification: two canonical-ID native reproductions (coding and text-only), one native-alias reproduction and one preview API reproduction fail. Default Low/High requests and two-turn file/test oracles pass. Desktop deep-research validation succeeds, but Start fails at plan stage with the same ModelUnavailableError (one child admitted, zero tokens). Main Desktop conversation and Side question pass with the same model. This is not the silent execution failure from historical #119.

## BUG-20261025-002 — Invalid reasoning variants silently run provider work

- Status: unresolved. GitHub: [#148](https://github.com/cluster1900/apexo-code/issues/148).
- Affected scope: primary CLI Antigravity variant validation.
- Baseline/environment: same as BUG-20261025-001.
- Reproduction: with a working agy account, run `bun run src/index.ts run --model antigravity/gemini-3.8-flash --variant definitely-invalid --format json "Reply INVALID_VARIANT_ACCEPTED. No tools."` from packages/apexo. Repeat with `--variant typo-effort`.
- Observed: both exit 0 with the requested assistant text and successful provider usage. No warning identifies the unsupported variant. The first request used 8,810 input tokens and 5 output tokens.
- Expected: reject the unsupported nonempty variant before inference and list valid choices, or explicitly report an intentional fallback.
- Root cause: unknown; the actual fallback tier was not established.
- Fix: none applied.
- Verification: two invalid strings reproduce; valid Low/High controls pass; invalid model IDs fail with an actionable error.

These are independent symptoms, not a claim of recurring identical root causes. No new recurring constraint is promoted.

## BUG-20261025-003 — Fork waits silently after a session changes directory

- Status: unresolved. GitHub: [#149](https://github.com/cluster1900/apexo-code/issues/149).
- Scope: primary CLI session import and fork. Baseline/environment: same as BUG-20261025-001.
- Discovery and reproduction: create a live session in disposable directory A; export it; import from directory B; run `run --dir "$A" --session "$SID" --fork --model antigravity/gemini-3.8-flash --variant low --format json "Reply OK. No tools." </dev/null`. The issue gives full setup.
- Observed: no stdout/stderr before 45–90 second external time limits. Repeated with a coding session, a text-only session, and closed stdin. Using directory B succeeds in 8.68 seconds; never-imported session fork also succeeds.
- Expected: adopt the existing placement or report the directory mismatch promptly.
- Root cause: the precise waiting path is unknown. Import intentionally updates placement to its current directory; this alone is not classified as a defect.
- Fix: none. Verification: failure and matching-directory controls as above.

## BUG-20261025-007 — Goal corrective turn repeatedly returns HTTP 400

- Status: unresolved. GitHub: [#153](https://github.com/cluster1900/apexo-code/issues/153).
- Scope: Desktop Goal worker continuation with Antigravity. Environment: same baseline/model, actual Electron and Node sidecar.
- Discovery/reproduction: fork a successful coding conversation; create a 20000-token text-only Goal and reach budget exhaustion; clear it while preserving messages; create a new exact-marker Goal with 200000 tokens; pause/resume planning and approve private plan writes; resume after a review failure. The worker emits both the earlier and new marker. Evaluation correctly requests only the new marker. The corrective worker then returns HTTP 400. Explicit Resume repeats that error in approximately 1.16 seconds. Full sequence and caveats are in the issue.
- Observed: infrastructure-paused at 166106 / 200000 tokens, usage incomplete; APIError statusCode=400, isRetryable=false, generic instruction to check the account.
- Expected: valid corrective work continues, or the rejected request is diagnosed sufficiently to distinguish it from account configuration.
- Root cause: unknown; account failure or provider outage is not established.
- Fix: none. Verification: two consecutive failures in one retained goal; the whole sequence was not recreated in a second clean goal. Concurrent ordinary Desktop prompts and a CLI attached to the same server/model succeed.
