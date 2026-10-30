# Browser model tool registration

## Bug ID

`BROWSER-MODEL-TOOL-001`

## Affected scope

The compatibility CLI and Desktop session tool registry used by `bun dev`, including the Grok Build tool profile.

## Observed behavior

Submitting a prompt beginning with `/browser` could cause the model to call the `computer` tool and then run the shell command `open <url>`. The model-facing tool list contained `computer` but did not contain a `browser` tool, so the model had no Browser Service/CDP action available. After the compatibility browser tool was added, free-form `/browser` text was still sent into the parent model turn instead of a dedicated browser subagent. On the Desktop new-session Home screen, the command could also show `Open a session before using /browser`: that screen has no `sessionID` until its first normal prompt is submitted. A child session could then be persisted successfully while the UI stayed on Home or the parent session, making the new browser agent appear to disappear.

## Expected behavior

The model must be able to call a `browser` tool for Chromium navigation and page actions. The tool must use Apexo's Browser Service, connect through Chrome DevTools Protocol, preserve browser session and page identity, and return Browser Service errors or screenshot attachments to the model. A free-form `/browser <task>` request must create a root session when it is submitted from Home, then create a child session owned by that root, select the hidden `browser` agent, admit the task to that child, and navigate the UI to the child immediately. The browser agent must see only the CDP browser tool. The shell `open` command is not a substitute for Browser Use.

## Reproduction

1. Start the local CLI with `bun dev` or the compatibility interactive runtime.
2. Submit `/browser` followed by a browser request.
3. Inspect the tool calls in the transcript.
4. Before the fix, the transcript showed `computer [action=open]` and `$ open <url>` without a `browser` tool call.
5. In Desktop, open the new-session Home screen and submit `/browser inspect <url> through CDP <endpoint>` before opening a session. Before the fix, the Home composer displayed the session-required error or forwarded the literal slash command to the model.
6. From an existing Desktop session, submit a free-form `/browser <task>`. Before the fix, the child was created in the API but the browser remained on the parent/Home route, so the child appeared to disappear.

## Root cause

The V2/Core Browser tool existed in `packages/core/src/tool/browser.ts`, but the compatibility registry in `packages/apexo/src/tool/registry.ts` only initialized `ComputerTool`. The compatibility path therefore exposed no model-facing `browser` definition. Its manual slash controller could call the V2 Browser API directly, but that did not make Browser available to provider tool selection. Independently, the Desktop Home composer is backed by `new-session-draft-controller.ts`, rather than the session command controller, so it had no local `/browser` registration. Its normal submit path would create a legacy session and send the literal command to the model. The new-session view also registers a command group under the `new-session` key, which shadowed a browser registration using that same key. Finally, the session command handler used `params.dir` for the child navigation target; in the affected route context that value could be absent, and the router fell back to `/` even though the child session had already been created.

## Fix

Added the compatibility `BrowserTool` adapter backed by `@apexo/core/browser`, registered it beside `ComputerTool`, and added `browser` to the Grok Build canonical tool names. The adapter uses the existing Browser Service for CDP open, observe, click, type, press, scroll, screenshot, and close actions, requests the existing `browser_destructive` permission for mutating actions, and returns screenshot artifacts as tool attachments. Added the hidden `browser` agent with a browser-only toolset and a dedicated prompt. Extended V2 session creation with `parentID`, and route free-form `/browser <task>` requests from CLI, TUI, and Desktop to a child session that runs the browser agent. Structured actions continue to route directly to the V2 Browser/Computer APIs. Hidden agents are excluded from the regular Task tool's advertised subagent list. Desktop and TUI now create a root session from their Home composer before running a structured Browser/Computer command or Browser subagent task; Desktop registers the Home slash command under a distinct key so the new-session command group cannot shadow it. After the child is created, Desktop and TUI navigate to its directory-scoped session URL before admitting the task, and Desktop derives that directory from the SDK rather than an optional route parameter. The CLI stream also registers manually created Browser children as subagent tabs, so they remain available from the terminal's agent picker even though no parent `task` tool part exists. This keeps the persisted child visible while its prompt is being admitted.

The default, Gemini, and Grok system prompts repeat the Browser routing rule so provider selection has the same instruction after the slash command is normalized.

## Verification

- `bun typecheck` from `packages/apexo` passes.
- `bun test test/agent/agent.test.ts test/tool/registry.test.ts test/tool/grok-build.test.ts test/cli/tui/slash-args.test.ts` from `packages/apexo` passes with 90 tests and 0 failures.
- The `coverage`, `auth`, and `effect` modes of `bun run script/httpapi-exercise.ts --fail-on-missing --fail-on-skip` each pass from `packages/apexo` with 357 passes, 0 failures, 0 skips, and 0 missing routes.
- `bun typecheck` from `packages/tui` passes.
- `bun typecheck` from `packages/app` passes.
- `bun typecheck` from `packages/client` and `packages/server` passes.
- `bun typecheck` from `packages/sdk/js` passes.
- `bun run build` from `packages/app` passes.
- `bun run build` from `packages/desktop` passes.
- `bun dev:desktop` starts the Vite/Electron development stack successfully on Bun 1.4.4; it was stopped after startup verification.
- `bun run script/browser-slash-ui.mjs cli` passes with autocomplete, CDP open, type, click, screenshot artifact, durable events, and close.
- `bun run script/browser-slash-ui.mjs desktop` passes the same flow through the rebuilt Desktop renderer and backend, including creation of a browser child session.
- `bun test test/cli/run/subagent-data.test.ts test/cli/run/stream.transport.test.ts` passes with 36 tests and verifies that a manually created Browser child is retained as a CLI subagent tab.
- The Desktop Playwright flow also submits a free-form `/browser <task>` from the new-session Home composer and verifies that it auto-creates a root session before creating the Browser child.
- The Desktop Playwright flow verifies that a free-form `/browser <task>` from an existing session changes the active URL to the created child session, proving that the persisted child remains visible in the UI.
- The TUI typecheck passes with the same Home-session auto-creation path for `/browser` and `/computer`.
- Both CLI and Desktop slash flows assert that the free-form request creates a child session with `parentID` set to the current session and `agent` set to `browser`.
- `bun run script/browser-computer-use.mjs` passes the direct CDP browser service flow.
- The generated client and SDK were regenerated from the updated protocol; their working-tree check commands report only the expected uncommitted generated diff.

## Remaining limitations

The acceptance provider is deterministic and verifies child-session routing plus the real Browser Service/CDP path; it does not measure a live provider's planning quality. A live provider should still be checked after the branch is rebuilt, with the transcript showing browser-agent tool calls and no shell `open` fallback.
