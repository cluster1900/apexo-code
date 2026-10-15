# BUG-20261014-278: LSP policy reference probe reversed polling arguments

- Scope: The isolated installed-runtime LSP policy acceptance script; no Apexo production behavior was affected.
- Observed: The first probe stopped at the initial process-count poll with `Timed out: 15000`, despite starting the configured processes.
- Expected: The shared poll helper should check until the numeric deadline and identify the condition in a failure message.
- Reproduction: Call the shared `poll` helper as `poll(check, 15000, "all policy servers attempted")`.
- Root cause: The fixture assumed the signature was `(check, milliseconds, label)`. The actual shared helper uses `(check, label, milliseconds)`. Passing a string as the timeout produced an invalid deadline.
- Fix: Use the existing helper's actual argument order at every new call site. The probe's cleanup still closed the isolated agent/provider and terminated its own traced server processes after the failed run.
- Verification: The corrected installed Grok Build 1.0.52 probe passed eight checks with three local provider requests. It verified one successful lifetime-budget recovery, zero-budget/default-disabled behavior, failed-startup budget consumption, no monitor after initial timeout, and no restart after Session closure. This is one fixture occurrence; no product fix or recurring-rule claim.
- Command after integration: From `packages/apexo`, run `bun script/grok-lsp-policy-official.mjs` with the installed reference available. The source-freeze verification used the same script from an isolated draft, without modifying the accepted checkout.
