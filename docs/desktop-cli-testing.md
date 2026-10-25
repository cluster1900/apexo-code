# Desktop and CLI acceptance plan

Prepared before execution on 2026-10-25 (America/New_York).
Baseline: `a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2`; Bun 1.3.14; macOS 26.6.2 arm64.
Feature scope: [inventory](desktop-cli-features.md). Execution results: [run record](testing/desktop-cli/2026-10-25.md).

## Method and evidence

1. Use isolated XDG data/config/cache/state directories and disposable project fixtures. Preserve native Antigravity credential ownership; never print token values.
2. Run the actual CLI, real terminal TUI, and actual Electron desktop. Observe visible UI and independently inspect produced files and persisted transcript. A provider/tool mock does not prove live Antigravity success.
3. Execute the following cases in order, recording PASS, FAIL, BLOCKED or NOT RUN for each. HELP success does not establish runtime success. A grouped case passes only when all named substeps pass.
4. For failures retain command, exit code, relevant redacted output, baseline, setup, exact sequence, actual and expected outcome. Repeat deterministic failures once where safe.
5. Search existing GitHub issues before creating one. Report distinct reproducible defects with discovery narrative, numbered reproduction, expected/actual results, frequency and environment. Do not invent a root cause.
6. Run generated-source writers and readers sequentially. Run package tests from their package directories; root Turbo orchestration is allowed. Do not restart an existing app/server.

## Test fixture and acceptance oracle

Create independent CLI and Desktop repositories containing `input.txt` with `ALPHA=37` and `BETA=5`. Ask the agent to read it, create `answer.txt` with `total=42\n`, add a small executable test and run it. Verify the bytes and test exit independently. Continue the same conversation: change the requirement to `total=43\n`, update and rerun its test, and verify retained context. The model may choose any available tool strategy; success is measured by outcome, not a prescribed tool name.

## Sequential matrix

| ID      | Steps                                                                           | Expected result                                                    |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ENV-01  | Record Git SHA/status, OS, Bun, Node, Electron; inspect native agy availability | Reproducible baseline and prerequisite status without secrets      |
| CLI-01  | Primary help/version; invoke every listed top-level command with --help         | Successful parsing and useful documented options                   |
| CLI-02  | Run packaged wrapper --help and --version; preview CLI --help                   | Entry points start or identify a missing platform build clearly    |
| CLI-03  | providers list, models antigravity, agent list, stats, session list, db path    | Real data or clear empty states; native catalog identified         |
| CLI-04  | memory status, plugins list, MCP list, completion bash/zsh                      | Valid output; no unintended user-state mutation                    |
| CLI-05  | Start isolated serve; health; authenticated and unauthenticated requests        | Ready health endpoint and correct authorization behavior           |
| CLI-06  | JSONL valid list, unsupported method, malformed line, then valid line           | Per-request errors and continued processing                        |
| CLI-07  | Preview serve/API: create session, prompt, wait, messages                       | Admission followed by response or surfaced execution error         |
| AGY-01  | Locate/install native CLI through official distribution; native model listing   | Native login/catalog available or explicit prerequisite blocker    |
| AGY-02  | Choose Antigravity Gemini; simple exact-marker text prompt                      | Real streamed provider response; no copied credential              |
| AGY-03  | Execute fixture coding task through primary CLI, JSON event format              | Actual read/write/test tools; file and test oracle pass            |
| AGY-04  | Resume same CLI session for changed requirement                                 | Correct persisted context and `total=43` output                    |
| AGY-05  | Native session protocol coding task and continuation                            | V2 model/tools/continuation satisfy same oracle                    |
| AGY-06  | Exercise low/high reasoning; invalid model and invalid variant                  | Supported variants work; invalid choices fail clearly              |
| CLI-08  | List/search exported session; export to file; import; trace/usage/stats         | Transcript and counts coherent; import produces usable session     |
| CLI-09  | Fork disposable session; continue fork; inspect original                        | Fork independent; original retained                                |
| TUI-01  | Start primary TUI in tmux; model picker; send fixture task                      | Real rendered terminal and tool/result visibility                  |
| TUI-02  | Continue, inspect help/slash commands, cancel active task                       | Correct input focus, continuation and scoped interruption          |
| DESK-01 | Build current Electron/sidecar; launch isolated instance; inspect initial page  | Ready composer; no startup error or stale source build             |
| DESK-02 | Open project via native picker; new tab; select Antigravity and variant         | Correct directory and visible persistent model selection           |
| DESK-03 | Submit fixture coding task; expand tools; inspect answer file and test          | Stream, tools and actual filesystem result agree                   |
| DESK-04 | Continue same conversation with changed requirement                             | Same session and correct final file/test result                    |
| DESK-05 | Add file attachment and multiline prompt; inspect context                       | Attachment delivered once; text/newlines preserved                 |
| DESK-06 | Permissions ask/deny then scoped allow in disposable fixture                    | Denied effect absent; approved action works                        |
| DESK-07 | Interrupt active task; send another prompt; test steer/queue                    | Busy state clears; later work remains usable                       |
| DESK-08 | Session list/search/rename; close/reopen tab; fork                              | History retained; exact session located; fork independent          |
| DESK-09 | Archive test session; open archived list; resume/retry                          | Transcript retained; clear valid action or explicit disabled state |
| DESK-10 | Export/import test session using native dialogs                                 | File created and readable imported history                         |
| DESK-11 | Command palette, help/tutorial, timeline, session info/usage                    | Correct action and unique timeline entries; useful data            |
| DESK-12 | General settings: theme/font/language; navigate away/back                       | No clipping; selection persists; restore test changes              |
| DESK-13 | Shortcuts search; Servers; Providers; Models                                    | All pages render and controls/empty states explain status          |
| DESK-14 | Plugins; MCP; invalid local MCP command with bounded wait                       | Clear empty state; no false connected status                       |
| DESK-15 | Open file tree/file/diff/terminal and execute fixture-only command              | Correct content and terminal output                                |
| DESK-16 | Goal objective; observe budget/status; pause/resume if available                | Lifecycle visible; completion/failure explicit                     |
| DESK-17 | Workflow using selected Antigravity model; side question                        | Usable model routing; result does not corrupt main conversation    |
| DESK-18 | Memory/hooks/agent dashboard/plan mode                                          | Panels accessible, scoped data and actionable empty states         |
| DESK-19 | Narrow window; keyboard navigation; menus; new window                           | Primary actions reachable, no overlay/focus traps                  |
| X-01    | CLI reads/exports Desktop-created session through same server                   | Identity, directory and transcript consistent                      |
| ERR-01  | Invalid path, malformed import, missing session, unreachable server             | Bounded useful errors with no false success                        |
| AUTO-01 | `bun turbo typecheck --concurrency=2` from root                                 | All typecheck tasks pass                                           |
| AUTO-02 | `GITHUB_ACTIONS=false bun turbo test --concurrency=2` from root                 | All package tests pass; capture actual counts/skips                |
| AUTO-03 | `bun run check:generated` in packages/client then packages/sdk/js               | Generated sources match canonical output                           |
| AUTO-04 | `bun run test:httpapi` in packages/apexo                                        | Coverage/auth/effect scenarios pass with no missing/skips          |

## Completion criteria

Report every matrix row with evidence or a concrete blocker. Never equate unexecuted cases, historical passes, skipped tests or quota failures with a passing live flow. Link confirmed defects to GitHub and leave unresolved defects marked unresolved. Publish documentation on a branch/PR after required checks have been run; do not merge as part of the audit.
