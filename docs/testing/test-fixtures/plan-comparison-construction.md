# BUG-20261015-096: Plan comparison fixture construction

- **Scope:** The isolated installed-runtime and compatibility Plan comparison scripts.
- **Status:** Corrected fixture; installed and CLI checks passed.
- **Observed:** The first installed batch probe failed its canonical-path assertion. The first compatibility probe marked a tool as selected but persisted no Plan input, so it did not exercise the intended operation.
- **Expected:** Read the actual structured tool result and instruct the shared local-provider fixture using its supported callback shape.
- **Root cause:** Two setup mistakes in one fixture-authoring episode: the installed path lives at `rawOutput.Entered.plan_file_path`, not directly under `rawOutput`; the shared provider callback takes `tool`, not `action`.
- **Fix:** Use the observed nested structured result and the callback's `tool` field. Require actual persisted Plan inputs and pending permission requests in compatibility checks. Require the installed exit approval to contain the later sibling write's final content.
- **Verification:** Installed default/ask/deny runs passed 5/4/1 checks with 14/9/10 local-provider requests. Corrected installed batch execution observed `BATCH_FINAL_PLAN` in the approval request even when exit preceded write in the provider batch. Corrected CLI acceptance passed 6 checks / 10 local-provider requests, including configured ask approval and rejection. The ineffective initial probe is not counted as passing behavior or as a product failure.
- The two setup mistakes are one authoring episode, not independent recurring occurrences.

The same comparison-authoring episode also initially sampled parked approval too early. The installed state RPC still reported false when the reverse approval request arrived; killing immediately preceded its asynchronous persistence. Waiting for the actual persisted pending flag, then killing and loading in a fresh process, passed four checks / three provider calls: the exact plan approval was re-presented, no provider request occurred before the answer, and explicit approval left Plan. This corrects a fixture observation assumption; no installed-runtime product repair is claimed.

The same comparison harness's shell follow-up initially assumed the installed command name was run_terminal_cmd/bash. Its recorded tool catalog instead advertised run_terminal_command. The probe now selects that observed canonical name. The corrected installed process completed and was reaped: Plan remained Active, a real allow-once permission callback preceded the scoped fixture marker write, and four local-provider requests were recorded. No product shell fix or extra historical occurrence is inferred from this construction correction.

## Independent headless comparison episode

The independent native-headless reference audit initially selected guessed shell names (`bash`, `run_bash`, `shell`). The installed provider catalog actually advertised `run_terminal_command`, matching the earlier shell follow-up construction mistake documented in this record. The local fixture asserted before emitting a tool request and terminated; its explicitly owned installed child was then stopped. This was a comparison-fixture error, not a product failure or an installed permission failure.

The corrected probe selects the observed canonical name and separates requests with tools from ancillary title requests. Nine actual installed scenarios were checked from their saved stdout/provider/filesystem evidence: three output formats, default permission cancellation, explicit auto approval, hard deny under auto, Question no-operator handling, and two termination signals. Eighteen local provider requests comprise twelve conversation requests and six ancillary title requests. All corrected children and provider listeners exited; no extra repetition is counted as an independent occurrence. No new bug ID or recurring rule is proposed by this amendment.

The guessed installed shell-name mistake has two independent occurrences. The other setup mistakes above remain separate causes; no recurring rule is promoted.
