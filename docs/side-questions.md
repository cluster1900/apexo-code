# Independent side questions

Apexo's `/btw` command asks a separate question about the current conversation. The main Session continues while the side answer runs. Side answers are stored separately and never admitted to the Session inbox or appended to its transcript. Cancelling an answer targets only that answer; closing the panel leaves it running.

The App provides a Side question button and `/btw` command in both composer layouts. The panel lists saved answers, accepts image attachments, refreshes pending answers, and cancels individual requests. The selected server protocol chooses the V1 or native V2 endpoint. Mini and fullscreen terminals expose the same local command, answer history, cancellation, and explicit image-file attachment. These commands do not fall through to the main model prompt.

## Architecture and boundaries

`SideQuestion` in Schema defines input and durable entries. The process-global `SessionSideQuestion` Core service owns independent scoped fibers and the `session_side_question` table. Both model adapters reuse that service. Entries are session-scoped, with running, completed, cancelled, and failed statuses. Images and copied conversation context are not persisted in this table. Provider error details are replaced with a generic message before persistence.

The V1 adapter uses Apexo's existing provider, agent, instruction, permission, and LLM services. Native V2 resolves the Session's Location and selected model, reads its native history and existing System Context epoch, and calls Apexo's LLM client directly. Neither adapter launches Grok or delegates Session orchestration. Both exclude incomplete tool calls from the snapshot and disable tool execution for the side answer. Native sampling does not reconcile System Context into the main transcript. V1 sampling clears the main Goal's usage context.

Admission is limited to four simultaneous side questions and 1,000 saved entries per Session. Questions fit within 64 KiB of UTF-8 text; answers fit within 1 MiB. Requests time out after 120 seconds. Up to 20 inline images are accepted, with an aggregate decoded limit of 50,000,000 bytes. Invalid or excessive attachments are rejected explicitly. PNG, JPEG, WebP, and GIF are accepted; V1 additionally checks the selected model's image capability. Unlike the reference runtime's omission notice, Apexo asks the user to correct an oversized attachment set before sending.

A process restart never retries unfinished provider work automatically. Reading a surviving running entry without a live local owner marks it cancelled. Completed answers remain readable after a process crash. This is process-local execution, consistent with the current Session execution architecture; clustered side-question ownership is not implemented.

## API

| Operation | V1 | Native V2 |
| --- | --- | --- |
| List | `GET /session/:sessionID/side-question` | `GET /api/session/:sessionID/side-question` |
| Ask | `POST /session/:sessionID/side-question` | `POST /api/session/:sessionID/side-question` |
| Cancel | `POST /session/:sessionID/side-question/:questionID/cancel` | `POST /api/session/:sessionID/side-question/:questionID/cancel` |

Ask accepts a question and optional inline images and returns the admitted entry. Cancel has no request body. Existing HTTP authorization and Session/directory routing apply. There is no proprietary feedback service or official-runtime adapter in this feature.

## Verification checkpoint

Run commands from `packages/apexo` using the pinned Bun 1.3.14 runtime.

| Verification | Command | Result |
| --- | --- | --- |
| Durable Core store | `bun test test/session/side-question.test.ts` | 3 tests, 14 assertions passed |
| Native V2 HTTP and local provider | `bun test test/e2e/v2-side-question.e2e.test.ts` | 1 test, 13 assertions passed |
| Real CLI server and local provider | `bun script/grok-side-question-parity.mjs cli` | 6 checks passed |
| Real mini PTY | `bun script/grok-side-question-tui.mjs` | 8 checks passed |
| Real fullscreen PTY | `bun script/grok-side-question-tui.mjs --fullscreen` | 9 checks passed |
| Built Desktop backend | `bun script/grok-side-question-parity.mjs desktop` | 6 checks passed |
| Native Desktop window | `bun script/grok-side-question-ui.mjs native` | 9 checks passed |
| Production browser UI with source CLI | `bun script/grok-side-question-ui.mjs cli` | 9 checks passed |
| Production browser UI | `bun script/grok-side-question-ui.mjs desktop` | 9 checks passed |
| Installed reference | `bun script/grok-side-question-official.mjs` | 3 checks passed: inherited context, separate reply, and image delivery |

The Core suite verifies sibling cancellation, transcript isolation, persistence, cross-session ownership, concurrent admission limits, image validation, and sanitized failure records. Real CLI checks hold the main provider request open while independent side questions finish or are cancelled, then verify that the main request still completes. Native V2 checks use actual HTTP and a local provider, including image input and an unchanged native transcript. Fullscreen checks also transfer an existing composer image into the side request. Terminal checks interact with real PTYs and a terminal emulator rather than inspecting flattened escape sequences.

App, TUI, Core, and Server package typechecks passed at the source checkpoint. A fresh production composer baseline immediately before this feature measured a 113.5 ms median and 124 ms p95 after two warmups; the final isolated post-build sample measured 110 ms median and 118 ms p95. See the [performance record](testing/performance/side-question-composer-baseline.md), which preserves an earlier concurrent sample separately. Functional acceptance passed in the built browser and native Desktop window, including visual screenshot inspection. The isolated benchmark showed no observed composer-readiness regression.

## Reference and localization

Behavior was compared with Grok Build source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, particularly `extensions/btw.rs` and `session/acp_session_impl/recap.rs`. Installed-runtime fixtures use an isolated configuration and a local provider. Reference evidence does not count as verification of Apexo execution.

English and Simplified Chinese App copy uses shared translation keys. Terminology was checked against [Microsoft Q&A's Chinese FAQ](https://learn.microsoft.com/zh-cn/answers/support/qna-faq) and [Firefox's Chinese screenshot guidance](https://support.mozilla.org/zh-CN/kb/firefox%20%E6%88%AA%E5%9B%BE), including question/answer, image, and cancel actions. “单独提问” is a contextual product label and remains a useful focus for native-speaker review. PNG, JPEG, WebP, GIF, and MB are retained technical identifiers.
