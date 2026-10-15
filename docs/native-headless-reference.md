# Installed headless comparison

`bun script/grok-native-headless-official.mjs` is a comparison-only fixture for installed Grok 1.0.52. `--inspect` captures only the isolated version/help and verifies the host-home read guard. `GROK_BIN` may select an explicit executable; the fixture resolves it and checks its version. Native Apexo execution never imports this script or depends on the Grok binary.

The fixture requires macOS `sandbox-exec`. From the first child it denies network access except the owned loopback provider port and owned Unix socket paths, denies host-home reads/writes except the executable, and supplies a whitelist environment with isolated HOME, GROK_HOME, XDG directories and TMPDIR. Model discovery is redirected locally; telemetry, updates, memory and imported integrations are disabled. Every received local request retains method, Host, path and synthetic body. Auxiliary discovery/title calls are reported separately from conversation requests. No host credentials, plugins or real provider are used.

Pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` exposes headless flags in `xai-grok-pager/src/app/cli.rs` and output/prompt parsing in `headless/cli.rs`. `headless.rs` handles automatic permission responses and signals. The shell's `session/prompt_parser.rs` accepts ACP text, embedded resources and image blocks. Runtime cases are selected only after inspecting actual installed help.

The comparison covers default/explicit plain, JSON and supported streaming output formats; a UTF-8 prompt file; ACP embedded text and image data; default ask, automatic approval and explicit Bash denial under automatic approval; and SIGINT/SIGTERM at actual provider or owned shell/sleep PID arrival. The fixture records exact current user content, tool-result evidence, process exits and post-exit PID identity. Forced fixture cleanup is identified separately and is never called joined cancellation. Deadlines bound the probes and finalizers join their owned processes.

These are distinct interfaces: official text files use `--prompt-file`, images and embedded resources use `--prompt-json`, while Apexo accepts explicit `--file` through canonical native admission. The fixture does not invent an official counterpart for Apexo input IDs, durable input outcomes, conditional cancellation or JSON event structure. Output differences are observations rather than reasons to replace Apexo's established contracts.

The original nine-scenario audit captured model-discovery warning text despite configuring a local conversation provider. That is an isolation audit clue, not proof of a destination, credential leak or user-profile write. This repeatable fixture adds explicit egress and host-home enforcement. The lightweight isolated preflight passed against `grok 1.0.52 (0920c8169e27)`: actual help advertises all four formats and the specified prompt/permission flags. The host-home read guard rejected a benign source file, the configured local provider port accepted its model-list request, and a second owned loopback port received zero requests. All preflight children were joined. The final sixteen-scenario matrix passed and exited zero; every owned process and provider listener was reaped.

Fixture corrections remain separate from product behavior. The first matrix selected a `session_title` Responses request as a conversation merely because it exposed a tool; the corrected classifier recognizes that ancillary protocol/tool before selecting current user content. The next run passed seven scenarios, then rejected an invalid one-pixel PNG fixture. The comparison now uses the existing verified 32×32 reference PNG and checks a normalized image content block rather than original bytes. The corrected final matrix passed all sixteen scenarios. Prior native PNG checks using the invalid literal established transport only, not successful image decoding. Built-in prose and browser-verification rules observed in requests are present verbatim in the pinned source; their presence does not show a host configuration read.

## Installed results

The final run used `grok 1.0.52 (0920c8169e27)` and made 19 actual conversation requests. Its 60 auxiliary requests comprise 17 model-list reads (including the isolation preflight), 16 discovery reads, 16 Responses title calls and 11 dashboard summary calls. Every received request used the single owned loopback provider Host. The sandbox also rejected a separate owned loopback port and a host-home read; no external provider or host credential was used.

| Comparison                             | Actual result                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Default and explicit plain             | Exact assistant text on stdout; exit 0                                                                              |
| JSON                                   | Result object with `text`, `stopReason`, Session/request IDs and usage; exit 0                                      |
| `streaming-json`                       | Text frames followed by an end frame with `end_turn`                                                                |
| `streaming-messages-json`              | Assistant content and successful result records                                                                     |
| UTF-8 prompt file                      | Selected current user message contains the supplied text                                                            |
| ACP text resource                      | Selected current user message contains embedded UTF-8 bytes                                                         |
| ACP image                              | Normalized image content block reaches the actual conversation request                                              |
| Default permission ask                 | Command does not execute; JSON `stopReason: cancelled`; process exits 0                                             |
| Automatic approval                     | Owned command executes and the model continues                                                                      |
| Hard Bash deny with automatic approval | Command does not execute; tool receipt reports policy denial, then the model continues                              |
| Question tool                          | Tool receipt reports no user is available; model continues without a fabricated answer                              |
| Held provider SIGINT/SIGTERM           | Process exits 130/143 respectively                                                                                  |
| Held shell SIGINT/SIGTERM              | Process exits 130/143; both recorded shell/sleep identities are absent at exit; no late write or forced PID cleanup |

The owned shell checks prove joined cleanup for those foreground commands. They do not prove every possible remote transport or background descendant contract. Provider-signal cases establish process exit and fixture cleanup, not a general TCP-close guarantee.

Apexo deliberately keeps its existing machine-output contract rather than reproducing either official JSON dialect. Its canonical input outcome and conditional cancellation APIs have no invented official equivalent. Default ask and unsupported interaction handling also have different receipt/exit semantics: official ask cancels the run with exit zero, while official Question returns a no-operator tool result and continues. These observations do not authorize automatic answers or weaken Apexo configured/inherited denial. Pinned source and installed behavior remain comparison evidence, separate from Apexo tests.

## Shared integration verification

The exact reviewed script and document were integrated with their base/final hashes checked. A subsequent invocation from the shared repository executed the full isolated matrix and again passed all sixteen scenarios with19 conversation and60 auxiliary requests. Both held-shell cases reported joined cleanup; all fixture processes/listeners were reaped and the command exited zero. This is a second run of the same corrected fixture, not an additional independent bug occurrence. No product files changed during this reference-only integration.
