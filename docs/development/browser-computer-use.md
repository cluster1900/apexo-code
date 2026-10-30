# Browser Use and Computer Use Development Audit

**Status:** detailed implementation audit and development plan
**Date:** 2026-10-30
**Repository:** Apexo
**Reviewed branch:** `browser-computer-use`
**Reviewed revision:** `1824c8e83d749c0c9014dacaa263a02a5d210b46`

This document records what Apexo currently implements for Browser Use and Computer Use, what has been verified, what still behaves like a prototype, and the work required to make both capabilities dependable in daily use. It is based on the source tree, the CLI/Desktop acceptance scripts, the V2 HTTP API, the current PR validation, and the official Playwright, Chrome DevTools Protocol, OpenAI Computer Use, and Anthropic Browser/Computer Use documentation listed at the end.

The central finding is that Apexo has a working control plane and a good deterministic acceptance harness, but it does not yet provide a complete closed-loop automation product. Browser Use is the stronger path: the real Chrome page can be attached, inspected, mutated, and replayed. Computer Use is still a guarded action adapter: on macOS it observes only the front application/window through AppleScript, sends coordinates and key presses through `cliclick`, and captures screenshots separately. The model does not yet receive a reliable screenshot/accessibility observation after every action and cannot consistently identify desktop controls by semantic reference.

## 1. Product contract we should implement

Browser Use and Computer Use are related but different products.

| Capability | Correct scope | Primary observation | Primary action space | Preferred backend |
| --- | --- | --- | --- | --- |
| Browser Use | Pages, tabs, forms, links, browser navigation and web application state | Accessibility tree, interactive element references, page text, tab state, screenshot when visual layout matters | Element references first, coordinates as fallback, navigation and keyboard actions | Playwright attached to Chrome/CDP |
| Computer Use | The whole desktop, native applications, windows, dialogs and non-web surfaces | Desktop screenshot, active app/window, accessibility nodes when available, optional OCR | Coordinate and semantic desktop targets, keyboard, window/application actions | Native OS accessibility plus screenshot driver |

The product must preserve these boundaries:

1. A request that stays inside a webpage should use Browser Use. It should not open a shell command or use a desktop coordinate click merely because the user mentioned Chrome.
2. A request about a native application, a desktop window, or a control outside a page should use Computer Use.
3. A model-generated action and a user-entered `/browser` or `/computer` action must pass through the same safety, permission, execution, event, and result pipeline.
4. Every mutating action must have an observation before it, a bounded execution, a post-action observation, and a verifiable result.
5. A user must be able to see whether the system is waiting for browser/desktop permission, connecting, executing, waiting for a result, blocked by stale state, or finished.
6. A process restart must not silently turn a visible historical session into an unusable live session. The system must either reconnect safely or report that the live target needs to be reattached.

## 2. Current architecture

The implementation is split across the correct package boundaries.

| Layer | Current implementation | Responsibility |
| --- | --- | --- |
| Shared schema | [`packages/schema/src/browser.ts`](../../packages/schema/src/browser.ts), [`packages/schema/src/computer.ts`](../../packages/schema/src/computer.ts) | Branded session/action/page/artifact IDs, action inputs, status, snapshots, durable event definitions, replay cursors |
| Core Browser service | [`packages/core/src/browser.ts`](../../packages/core/src/browser.ts) | Playwright CDP connection, page discovery, page snapshots, ARIA snapshot, actions, screenshots, snapshot fencing, durable events |
| Core Computer service | [`packages/core/src/computer.ts`](../../packages/core/src/computer.ts) | macOS observation through `osascript`, `cliclick` actions, screenshots through `screencapture`, deterministic fixture backend, durable events |
| Core model tools | [`packages/core/src/tool/browser.ts`](../../packages/core/src/tool/browser.ts), [`packages/core/src/tool/computer.ts`](../../packages/core/src/tool/computer.ts) | V2 model-facing tools and V2 permission assertions |
| Public HTTP API | [`packages/protocol/src/groups/browser.ts`](../../packages/protocol/src/groups/browser.ts), [`packages/protocol/src/groups/computer.ts`](../../packages/protocol/src/groups/computer.ts) | List, open, action, close, and replay endpoints |
| HTTP handlers | [`packages/server/src/handlers/browser.ts`](../../packages/server/src/handlers/browser.ts), [`packages/server/src/handlers/computer.ts`](../../packages/server/src/handlers/computer.ts) | Session ownership checks, error mapping, service dispatch |
| Compatibility tools | [`packages/apexo/src/tool/browser.ts`](../../packages/apexo/src/tool/browser.ts), [`packages/apexo/src/tool/computer.ts`](../../packages/apexo/src/tool/computer.ts) | Legacy/compatibility model tool adapters and `ctx.ask` permission calls |
| Tool registry | [`packages/apexo/src/tool/registry.ts`](../../packages/apexo/src/tool/registry.ts), [`packages/apexo/src/session/tools.ts`](../../packages/apexo/src/session/tools.ts) | Advertises Browser and Computer to normal agents; restricts the hidden Browser agent to the Browser tool |
| Browser agent | [`packages/apexo/src/agent/agent.ts`](../../packages/apexo/src/agent/agent.ts), [`packages/apexo/src/agent/prompt/browser.txt`](../../packages/apexo/src/agent/prompt/browser.txt) | Hidden `browser` subagent with a Browser-only toolset |
| CLI/TUI | [`packages/apexo/src/cli/cmd/run/runtime.ts`](../../packages/apexo/src/cli/cmd/run/runtime.ts), [`packages/apexo/src/cli/cmd/run/footer.view.tsx`](../../packages/apexo/src/cli/cmd/run/footer.view.tsx), [`packages/tui/src/component/prompt/index.tsx`](../../packages/tui/src/component/prompt/index.tsx) | `/browser` and `/computer` parsing, session state, action queues, terminal feedback, child-agent tabs |
| Desktop | [`packages/app/src/pages/session/use-session-commands.tsx`](../../packages/app/src/pages/session/use-session-commands.tsx), [`packages/app/src/pages/new-session/new-session-draft-controller.ts`](../../packages/app/src/pages/new-session/new-session-draft-controller.ts) | Slash commands, Home-session creation, Browser child routing, toasts, session hydration |
| Shared command grammar | [`packages/sdk/js/src/v2/browser-command.ts`](../../packages/sdk/js/src/v2/browser-command.ts), [`packages/sdk/js/src/v2/computer-command.ts`](../../packages/sdk/js/src/v2/computer-command.ts) | Quoted tokenization and structured slash action parsing |
| Acceptance harness | [`packages/apexo/script/browser-computer-use.mjs`](../../packages/apexo/script/browser-computer-use.mjs), [`packages/apexo/script/browser-slash-ui.mjs`](../../packages/apexo/script/browser-slash-ui.mjs), [`packages/apexo/script/computer-slash-ui.mjs`](../../packages/apexo/script/computer-slash-ui.mjs) | Real CDP page fixture, CLI PTY interaction, Desktop Playwright interaction, provider fixture and state assertions |

## 3. What currently happens, step by step

### 3.1 Manual Browser command in CLI or Desktop

For `/browser open https://example.test` or `/browser type "#search" "hello"`, the current path is:

1. The CLI footer or Desktop command catalog recognizes the slash prefix.
2. The shared parser converts the text into a structured action. It supports `open`, `observe`/`snapshot`, `click`, `type`, `press`, `scroll`, `screenshot`, `events`, and `close`.
3. The surface-specific action queue serializes commands for that UI session.
4. The surface creates a root Session when it has enough model/agent context and is still on the Desktop Home composer.
5. `browser.open` creates a process-local Browser session and calls `Browser.Service.open`.
6. The Browser service validates the URL as `http` or `https`, resolves a CDP endpoint, and calls `chromium.connectOverCDP`.
7. It chooses a page whose URL exactly matches the requested URL, then a blank/new-tab page, then creates a new page.
8. It navigates with `page.goto(..., { waitUntil: "domcontentloaded" })`.
9. It creates a `Page` snapshot containing page ID, URL, title and a hash of `document.documentElement.outerHTML`.
10. It writes `browser.session_started` and `browser.page_changed` durable events.
11. Subsequent actions require the Browser session ID. Mutating actions can carry `pageID` and `expectedSnapshotHash`; a mismatch returns `stale_target`.
12. `observe` returns visible body text, a Playwright ARIA snapshot and recent console lines.
13. `click` uses a CSS selector and Playwright locator click.
14. `type` uses `locator.fill`, which replaces the existing control value.
15. `press` calls `page.keyboard.press` against the current page focus.
16. `scroll` evaluates `scrollBy` in the page.
17. `screenshot` saves a PNG under `.apexo/browser/<session>/<artifact>.png`, emits an artifact event and returns base64 data to the model adapter.
18. `events` reads the durable aggregate and returns `earliest`, `head`, and an optional continuation cursor.
19. The UI updates its page ID and snapshot hash after each result and shows a toast or terminal result.
20. `close` closes the Playwright Browser connection and removes the process-local session.

The service is therefore able to operate a real CDP page. It is not yet a complete Browser Use agent because the model does not receive stable element references, tab state, post-action wait state, or a consistent observation attachment after every mutation.

### 3.2 Free-form Browser task

For `/browser search for the release notes and summarize the latest version`, the current path is different:

1. The CLI or Desktop identifies the text as a task rather than a structured action.
2. It ensures a root Session exists.
3. It creates a child Session with `parentID` and `agent: "browser"`.
4. The CLI registers that child in its subagent tab list; Desktop navigates to the child route.
5. It admits the user task to the child Session.
6. The hidden Browser agent receives the Browser-only prompt and the Browser tool.
7. The model is expected to call `browser.open`, then observe, then act with page IDs and snapshot hashes.
8. The model-facing tool calls the Core Browser service and returns text or a screenshot attachment.
9. The child continues until the provider returns a normal answer.

This path fixes the earlier shell `open` fallback for the dedicated Browser agent. It still relies on the model choosing the Browser tool correctly when the user gives a normal natural-language request without `/browser`. Prompt rules help, but prompt rules are not a deterministic router or a safety boundary.

### 3.3 Manual Computer command

For `/computer open`, `/computer observe`, `/computer click 120 240`, or `/computer type "hello"`, the current path is:

1. CLI/TUI/Desktop parse the command and serialize actions per UI session.
2. The command calls the V2 Computer HTTP API directly.
3. The service selects `fixture` only when `APEXO_COMPUTER_BACKEND=fixture` is set and the request did not force `native`.
4. On macOS native mode, `observe` runs AppleScript through `/usr/bin/osascript` and returns only the front application name and first window name as text.
5. Native `click`, `type`, `press`, and `scroll` run `cliclick`. `target` is currently not interpreted by the Core service.
6. Native `screenshot` runs `/usr/sbin/screencapture` and stores a sensitive PNG artifact.
7. Fixture mode mutates a small in-memory state (`activeApp`, `window`, `text`) so tests can verify changed snapshots.
8. A snapshot hash is checked before mutating actions when the caller sends `expectedSnapshotHash`.
9. Durable `computer.session_started`, `computer.action_started`, `computer.action_completed`, `computer.artifact_created`, and `computer.closed` events are written.
10. The UI receives a short toast or terminal string and updates its cached snapshot hash.

This proves the transport and event path, but it does not yet prove that a native desktop control was found, clicked, or typed into. A fixture result such as `Clicked 120,240` is a state-transition assertion, not evidence that a real macOS window changed.

### 3.4 Automatic Computer tool use

The model-facing V2 and compatibility Computer tools are more complete than direct slash commands:

1. The normal agent tool registry advertises `computer`.
2. The provider decides whether to call it based on the user request and system prompt.
3. The V2 Core tool calls `PermissionV2.assert`; the compatibility adapter calls `ctx.ask` for destructive actions.
4. `computer.open` starts a session and returns a snapshot.
5. The model is expected to call `observe` or `screenshot`, select coordinates and call a mutating action.
6. The action returns a snapshot or screenshot artifact, allowing the provider to continue.

The automatic acceptance fixture deterministically injects a `computer.open` call. That verifies tool registration and transport, but it does not measure whether a live model correctly recognizes a desktop request, chooses Computer Use instead of shell or Browser Use, asks for approval, interprets a screenshot, or verifies a postcondition.

## 4. What is implemented and working well

### 4.1 Browser Use strengths

- The public V2 Browser contract is explicit and typed.
- Browser actions and replay events are durable and scoped to a Browser session aggregate.
- Server handlers reject a Browser session that belongs to another Session.
- Playwright is used as a thin CDP adapter rather than reimplementing all CDP request plumbing.
- URL validation rejects non-HTTP(S) page navigation.
- Target selection prefers an exact URL and avoids commandeering an unrelated active tab when a blank/new-tab target exists.
- `pageID` and `expectedSnapshotHash` provide a useful stale-target guard.
- `type` replaces a control value instead of appending to an old value.
- Screenshots are saved as artifacts and can be attached to model tool results.
- CLI and Desktop use a per-session queue, which prevents the most obvious stale-cursor race from back-to-back UI commands.
- Free-form `/browser` creates a dedicated hidden Browser subagent instead of exposing the parent agent to unrelated tools.
- Desktop Home and existing-session flows both have acceptance coverage for Browser child creation and route selection.

### 4.2 Computer Use strengths

- Native Computer Use is guarded behind a dedicated service and typed action contract.
- The macOS backend reports a useful explicit failure when the platform, Accessibility permission, or `cliclick` executable is unavailable.
- Native screenshots are marked sensitive and are stored separately from Browser screenshots.
- `expectedSnapshotHash` prevents a caller from blindly acting on a known stale Computer snapshot.
- The fixture backend is stateful enough to prove that an action caused an observable state transition.
- V2 model tools use the V2 permission service, and compatibility model tools use the compatibility permission service.
- Durable event replay exists for both Browser and Computer actions.

### 4.3 Acceptance and engineering strengths

- Playwright is used as a test driver for the Desktop UI and a real CDP browser fixture; it is not being mistaken for product automation coverage.
- The terminal suite drives the actual CLI PTY and checks rendered autocomplete and results.
- The current acceptance scripts assert actual page DOM changes for Browser Use and snapshot changes for fixture Computer Use.
- The Desktop bundle resolves `playwright-core` and `chromium-bidi` successfully.
- HTTP API coverage includes Browser and Computer routes.
- The implementation follows the repository dependency direction: Schema → Core/Protocol → Server, with Client/App consuming generated contracts.

## 5. What is incomplete or does not yet meet the product contract

The following are the issues most likely to explain poor real-world behavior.

### P0: safety and control-plane inconsistencies

| Gap | Current behavior | Why this is a product problem | Required change |
| --- | --- | --- | --- |
| Structured slash actions bypass the permission service | Desktop and CLI slash handlers call V2 Browser/Computer endpoints directly. The HTTP handlers validate ownership but do not evaluate `destructive`; the flag is caller-provided metadata. | A user can type `/browser click`, `/browser type`, `/computer click`, or `/computer press` without the same approval flow used by model tools. | Route direct actions through a shared automation permission coordinator. The server must classify the action itself, create an approval event/request, and ignore a client claim that an action is safe. |
| Browser/Computer approval events are defined but not emitted | `browser.approval_required`, `computer.approval_required`, and Browser disconnected schemas exist, but Core service paths do not publish them consistently. | The UI cannot reliably show why execution stopped or what the user must approve. | Emit approval, denied, cancelled, disconnected and recovery events from the authoritative service boundary. |
| No single execution state model | UI toasts and terminal strings are separate from durable action state. There is no shared `queued → connecting → awaiting_approval → running → observing → completed/failed` state. | The input area can appear blocked or the action can seem to disappear, especially when a child Session or provider loop is running. | Add an `AutomationRun` state machine and render it in a persistent activity surface in CLI and Desktop. |
| User consent is not explicit at connection time | Browser assumes a CDP endpoint or default `127.0.0.1:9222`; Computer assumes native permissions are already configured. | Users do not know which Chrome profile or desktop scope is being controlled. | Add first-use connection/permission onboarding, target identity display, origin/application scope, and an explicit user confirmation before attaching to an existing target. |

### P0: Computer Use is not yet a reliable computer-use loop

| Gap | Current behavior | Required change |
| --- | --- | --- |
| Observation is too weak | Native `observe` returns front application and first window name from AppleScript. It does not return a screenshot, accessibility tree, focused control, window bounds, or actionable target references. | Return a screenshot and a structured observation containing display size, active app/window, accessibility nodes, roles, names, bounds, stable references and focus. Keep a text summary for small models, but do not make it the only observation. |
| Action success is not verified | Native `cliclick` exit success is treated as action success. A click can land on the wrong window or a disabled control and still exit successfully. | Capture an after-observation, compare the expected postcondition, and return `verified`, `changed`, `unchanged`, or `unknown`. A provider turn must see the after-state. |
| Semantic target is ignored | `target` is accepted in the schema/tool but the Core native action path only uses coordinates or text/key arguments. | Resolve a semantic target to an accessibility node or require a coordinate fallback with a clear warning. |
| Screenshot is optional instead of part of the loop | `screenshot` is a separate action and `computer.open`/mutation responses do not always include an image. | Return a normalized image observation after open and after each mutation, with a configurable sampling policy for cost control. |
| Platform scope is macOS-only | Non-macOS returns unsupported. Native macOS depends on `osascript`, `screencapture`, Accessibility permissions and `cliclick`. | Define a backend capability handshake. Ship a robust macOS backend first, then add Windows UI Automation and Linux AT-SPI/portal backends or explicitly mark those platforms unsupported in the product UI. |

### P1: Browser Use is functional but too brittle for general pages

| Gap | Current behavior | Required change |
| --- | --- | --- |
| No stable element references | The model gets body text and an ARIA snapshot string, but action inputs require CSS selectors. | Generate per-tab element references such as `ref_1`, map them to accessibility-node IDs/selectors, keep them stable until navigation or material DOM change, and return a stale-reference error that tells the model to re-read the page. |
| CSS selectors are the only semantic action target | A user or model must invent a selector. Selector escaping, shadow DOM, iframes and virtualized content are not covered by the public contract. | Support reference targets first, then role/name/label/text locators, then CSS as an escape hatch. Add explicit iframe/tab scope. |
| Keyboard actions are page-global | `press` uses `page.keyboard.press` without a target or focus assertion. | Accept a target/reference or explicit focus target, report the focused element in observations, and fail if focus is ambiguous. |
| Fixed sleeps replace readiness | Open waits for `domcontentloaded`, click sleeps 50ms, and there is no network/UI stability policy. | Add bounded waits for locator readiness, navigation, DOM mutation, network idle where appropriate, and explicit `wait_for`/postcondition actions. |
| Limited tab model | Core state stores one `page` per Browser session. The protocol exposes one Page, not a tab list or active-tab switch. | Add tab IDs, list/switch/new/close tab operations and persist active tab identity. |
| Connection startup is manual | The default is `http://127.0.0.1:9222`; Apexo does not launch Chrome, attach by Chrome channel, or guide the user through Chrome remote-debugging permission. | Add a connection manager with `channel`, endpoint, and explicit attach modes. Detect Chrome availability and show a guided setup dialog. |
| Page content is treated as trusted context | Page text, console output and screenshots are returned to the model without a dedicated prompt-injection signal or origin policy. | Treat page content as untrusted input, enforce origin/network allowlists, add prompt-injection warnings, and require human confirmation for consequential actions. |

### P1: lifecycle, persistence and failure handling

1. Browser and Computer live sessions are stored in process-local `Map` objects. Durable events survive, but a process restart cannot restore the active Playwright connection or native desktop handle.
2. Browser disconnected state changes the in-memory `connected` flag, but the service does not consistently publish `browser.disconnected` with a reason.
3. Browser `close` calls `browser.close()` without awaiting the connection shutdown or recording a final close failure.
4. There is no explicit cancellation endpoint for a running Browser/Computer action. A long Playwright action and a native `cliclick` process need abort propagation.
5. Core services do not serialize concurrent API callers. CLI and Desktop queues cover their own surface, but two clients can still act on the same Browser/Computer session concurrently.
6. Replay cursors are durable event cursors, not live-connection checkpoints. Replaying an event does not reattach to the target or restore a model-visible observation.
7. Artifact retention, cleanup, size limits and sensitive-data redaction are not defined as a product policy.

### P1: routing and UX differences

1. Automatic tool routing depends on model behavior and prompt text. `/browser` is deterministic, but a normal request such as “open Chrome and search for…” can still be routed to Computer Use or shell depending on the provider.
2. The Browser child agent is hidden and Browser-only, but there is no equivalent dedicated Computer agent with a clearly constrained toolset and explicit visual loop.
3. Desktop uses toasts for many automation results. A toast is not sufficient for a multi-step run, approval wait, reconnect, or provider retry.
4. CLI and Desktop do not expose the same progress vocabulary, action details, screenshot preview, or retry controls.
5. `/computer` session creation behavior is not fully symmetric across all CLI/TUI/Home states. Some CLI paths still require an existing Session while Desktop can create one from Home.
6. The user cannot easily inspect the currently attached Chrome tab, active desktop application, backend type, permission state, or last observation from the normal session UI.

### P2: test coverage that is still missing

The current acceptance harness is valuable, but its scope is narrower than production behavior.

- Browser tests use a local test page and a test Chromium process. They do not cover a real user Chrome profile, Chrome's remote-debugging permission dialog, extension pages, authentication, downloads, popups, dialogs, cross-origin iframes, shadow DOM, large virtualized pages, or network timeouts.
- Computer tests use `APEXO_COMPUTER_BACKEND=fixture` for deterministic state changes. They do not exercise a real macOS application, Accessibility consent, `screencapture` output, `cliclick` coordinate accuracy, window movement, multiple displays, Retina scaling, or permission denial.
- Automatic provider tests inject deterministic tool calls. They do not establish model routing quality, screenshot interpretation quality, prompt-injection resistance, or provider-specific tool-call batching.
- No restart test proves reconnect or fail-closed behavior after the server, CLI, Desktop renderer, or Chrome process restarts.
- No negative permission test proves that a direct slash command pauses for approval and remains blocked until the user accepts.
- No stale-target stress test runs two callers concurrently against the same Browser or Computer session.
- No contract test checks that every action that exists in the schema is visible and correctly documented in CLI autocomplete, TUI commands, Desktop commands, model tool schemas and help text.

## 6. Recommended target architecture

### 6.1 A shared Automation Session model

Introduce a shared domain concept above Browser and Computer:

```text
AutomationSession
  id
  sessionID
  kind: browser | computer
  backend
  status: connecting | ready | awaiting_approval | running | observing |
          disconnected | stale | closed | unavailable
  target identity
  capability snapshot
  owner / generation
  current observation hash
  current cursor
  createdAt / lastActionAt
```

Browser and Computer keep their domain-specific fields, but both use the same lifecycle, permission, event, cancellation, reconnect and UI vocabulary.

### 6.2 A single permission boundary

All of the following must call the same coordinator:

- V2 model tools.
- Compatibility model tools.
- CLI structured slash commands.
- TUI structured slash commands.
- Desktop structured slash commands.
- Any future MCP or external automation adapter.

The coordinator must classify the action from the server-side action name, not trust the `destructive` boolean supplied by a client. The minimum policy should be:

| Action | Default policy |
| --- | --- |
| Attach to an existing Chrome target | Ask once per Browser connection and show target identity |
| Navigate to a new origin | Ask unless the origin is already approved for the Session |
| Read/observe/screenshot | Allow after connection approval, subject to target scope |
| Click/type/press/scroll | Ask on the first action, then follow the user's once/always choice |
| Upload, download, account change, purchase, message, accept terms, delete or close an application | Always require a fresh explicit confirmation |
| Computer actions affecting the OS or another application | Ask with application/window context |

The approval request must be durable, visible, cancellable, and linked to the action ID. A permission approval must not be silently reused for a different origin, application, target, or action class.

### 6.3 Browser observation and target references

The Browser observation result should contain:

```text
BrowserObservation
  browserSessionID
  tabID
  pageID
  url / title
  viewport { width, height, deviceScaleFactor }
  text
  accessibilityTree
  elements[]
    ref
    role
    name
    value
    bounds
    selector / locator metadata
    enabled / visible / focused
  screenshot artifact or inline image
  snapshotHash
  generatedAt
```

Element references are scoped to a tab and observation generation. A reference remains valid until navigation or material DOM change. A stale reference must return a typed error that tells the model to observe again. This is more dependable than requiring a model to invent CSS selectors from plain text.

### 6.4 Computer observation and target references

The native Computer backend should return:

```text
ComputerObservation
  computerSessionID
  display { width, height, scale }
  activeApp { bundleID, name, pid }
  activeWindow { title, bounds }
  focusedElement?
  accessibilityNodes[]
    ref
    role
    name
    value
    bounds
    enabled / focused
  screenshot artifact or inline image
  snapshotHash
  generatedAt
```

Actions should accept either a semantic `ref` or a coordinate. Coordinate actions must include the display/viewport generation that produced them. The executor should return an after-observation and a verification classification.

### 6.5 Closed-loop model execution

A reliable model turn should follow this loop:

1. Decide whether Browser Use or Computer Use is the correct capability.
2. Connect or reuse a scoped automation session.
3. Observe and return structured state plus an image when visual state matters.
4. Ask for permission before a consequential action.
5. Execute one action or an explicitly ordered safe batch.
6. Stop the batch after the first failure; mark later actions as not executed.
7. Return the post-action observation and verification result.
8. Let the provider decide whether to continue.
9. Stop on success, explicit user confirmation, cancellation, stale target, timeout, disconnect, or safety policy failure.

The provider must receive one tool result for every tool call. The executor must never drop a call, silently continue after a failed prerequisite, or claim success from a process exit code alone.

## 7. Detailed implementation roadmap

### Phase 0 — Establish the contract and failing tests

**Goal:** make the current gaps observable before changing the backends.

1. Add protocol tests for permission-required Browser and Computer actions through the direct V2 endpoints.
2. Add a test proving that `destructive: false` cannot bypass server-side classification.
3. Add a test proving direct CLI and Desktop slash actions generate the same approval request as model tool actions.
4. Add event assertions for approval, denied, cancelled, disconnected and recovery states.
5. Add a restart test that proves the current behavior is explicitly either reconnectable or fail-closed.
6. Add a contract matrix test for schema actions, parser actions, CLI autocomplete, Desktop command catalog and model tools.

**Exit criteria:** all missing behavior is represented by a failing test or a documented platform boundary.

### Phase 1 — Unify permissions and progress state

**Goal:** remove the safety difference between manual and automatic use.

1. Create a shared `AutomationPermission` service in Core/Server.
2. Move action risk classification to the server/core boundary.
3. Add durable approval request records and `approval_required`/`approval_resolved` events.
4. Make CLI, TUI, Desktop and model tools consume the same approval state.
5. Add a shared `AutomationRun` lifecycle and current-action record.
6. Replace one-off toasts with a persistent activity row/panel showing target, action, elapsed time, approval state and cancel/retry controls.
7. Preserve the current prompt input state while an automation action runs; disable only the conflicting action, not the entire composer.

**Exit criteria:** a user sees the same approval and progress behavior regardless of whether the action came from a model or a slash command.

### Phase 2 — Make Browser Use reliable

**Goal:** support semantic page operation instead of selector guessing.

1. Add tab/session capability discovery and a connection onboarding flow.
2. Implement `read_page`/`find` style element references backed by accessibility nodes and locator metadata.
3. Add `tabID`, list/switch/new/close tab operations.
4. Scope `click`, `type`, `press`, `scroll` and screenshot to a tab and optional element reference.
5. Add focus reporting and targeted keyboard actions.
6. Add bounded waits and explicit wait/postcondition operations.
7. Return structured observation and optional image after mutations.
8. Add origin allowlists, redirect checks, loopback/private-network policy and prompt-injection warnings.
9. Add a CDP connection manager that supports endpoint, Chrome channel, and explicit user-attached modes.
10. Publish disconnected events and expose reconnect/reattach actions.

**Exit criteria:** a Browser agent can read interactive references, act on references, recover from stale references, handle tabs and verify page state without requiring a CSS selector guessed by the model.

### Phase 3 — Make Computer Use reliable on macOS

**Goal:** provide a real screenshot/accessibility/action loop.

1. Define a native backend interface with `capabilities()`, `observe()`, `act()`, `capture()`, `cancel()` and `close()`.
2. Add a small signed/packaged macOS helper where necessary for Accessibility API access instead of relying only on AppleScript window names.
3. Return screenshot, display geometry, active application, active window and accessibility nodes from `observe`.
4. Resolve semantic target references to accessibility nodes; preserve coordinate fallback for canvas and inaccessible surfaces.
5. Normalize Retina/display coordinate transforms.
6. Capture an after-observation after every mutation and classify whether the requested state changed.
7. Surface Accessibility permission status and a guided System Settings link.
8. Detect missing `cliclick` and either install/locate a bundled driver or clearly explain the supported installation path.
9. Add application/window allowlists and a user-visible active-target label.
10. Add a Computer-only hidden agent or an equivalent toolset policy that guarantees screenshots and ordered tool results.

**Exit criteria:** a model can see the current desktop, identify a semantic target or coordinate, act, receive a new screenshot/accessibility observation, and stop when the requested postcondition is verified.

### Phase 4 — Deterministic routing and model loop

**Goal:** make automatic triggering dependable.

1. Add a deterministic intent classifier before model execution for strong signals such as `/browser`, `/computer`, “Chrome tab”, “web page”, “desktop app”, “window”, “close button”, and “click the desktop”.
2. Use the classifier to constrain the available tools, while allowing the model to request a deliberate handoff.
3. Ask one clarification question when Browser and Computer scopes are ambiguous.
4. Add provider adapter support for ordered batches and one result per call.
5. Add image and accessibility payload budgeting so large observations do not exhaust the context window.
6. Add a postcondition field to the tool contract and feed verification results back to the model.
7. Record routing decisions and the reason for each handoff in the durable trace.

**Exit criteria:** the same request selects the same capability across supported providers, and the user can understand why that capability was selected.

### Phase 5 — Persistence and recovery

**Goal:** make sessions safe across process and browser restarts.

1. Persist automation session metadata, backend, target identity, permission scope, last observation and owner generation.
2. Keep secrets out of event payloads; store CDP credentials or headers in an OS-backed secret store when required.
3. On restart, scan sessions and classify them as reconnectable, reattach-required, stale, or closed.
4. Reconnect Browser sessions only when the endpoint and target identity still match.
5. Re-observe after reconnect and invalidate old page/element references.
6. Recreate Computer observations after macOS permission and display validation.
7. Fence concurrent owners and make cancellation/close idempotent.
8. Expose recovery status in CLI/Desktop instead of silently dropping the live connection.

**Exit criteria:** a restart test has a deterministic, user-visible outcome and cannot cause a replacement owner to act on a stale target.

### Phase 6 — UX and diagnostics

**Goal:** make automation understandable while it runs.

1. Add an Automation panel with target, backend, current observation preview, action timeline, approval state and cancel control.
2. Keep the composer usable while the automation runs; route output to the timeline instead of replacing the input area.
3. Add `/browser status`, `/computer status`, `/browser reconnect`, `/computer reconnect`, `/automation cancel` and `/automation events`.
4. Show the active Chrome tab or desktop application before destructive actions.
5. Add screenshot preview and artifact retention controls.
6. Add a sanitized trace export containing routing, approvals, observations, actions, failures and cursors.

**Exit criteria:** a user can explain what is executing, what target is controlled, what approval is pending and how to recover without reading logs.

## 8. Test plan

### Unit and contract tests

- Parser quoting, escaped text, invalid arguments and help output.
- Schema validation for all action combinations.
- Server-side destructive classification independent of client metadata.
- Permission once/always/deny/revoke semantics.
- Snapshot and element-reference stale detection.
- Tab ownership and Session ownership.
- Event ordering and replay cursor boundaries.
- Cancellation, timeout, first-failure batch halt and idempotent close.
- Artifact size, sensitivity and cleanup policy.

### Browser backend tests

- Exact-target selection with unrelated tabs.
- Blank/new-tab reuse.
- Dedicated target creation.
- Cross-origin navigation and redirect policy.
- Selector/reference action success and stale reference recovery.
- Focused keyboard input.
- SPA navigation and bounded wait behavior.
- Popup/new-tab creation and tab switching.
- CDP disconnect, page close, browser restart and reconnect.
- Screenshot and accessibility result size limits.

### Computer backend tests

- Native macOS permission missing/approved/denied.
- Active application/window changes.
- Multiple displays and Retina scaling.
- Accessibility node reference resolution.
- Coordinate fallback on inaccessible/canvas content.
- Screenshot before and after an action.
- `cliclick` missing, non-zero exit, timeout and cancellation.
- Window moved/closed between observe and act.
- Native app dialog and close-button postconditions.

### CLI and Desktop acceptance

Playwright must remain a test driver for the Desktop UI. The test must assert both sides of the interaction:

1. The human-like prompt or slash command is entered into the actual composer.
2. The UI shows the expected autocomplete/progress/approval state.
3. The backend state changes in the real browser or native fixture.
4. The resulting event, snapshot, screenshot and cursor are verified.
5. The composer remains usable or visibly reports why it is blocked.
6. A failure is injected and the UI reports the recovery path.

Terminal tests must use the actual CLI PTY and verify:

1. Slash autocomplete and help output.
2. Human-like command entry and terminal rendering.
3. Permission prompt and response.
4. Browser/Computer action result and event cursor.
5. Subagent tab visibility for free-form Browser tasks.
6. Reconnect/cancel/error output.

### Provider and live-environment tests

- At least one live provider per supported tool-call dialect.
- One deterministic provider fixture for every failure boundary.
- A real headed Chrome attach test with the user-approved remote-debugging flow.
- A real macOS Accessibility test on a disposable native app.
- A prompt-injection fixture in page text and screenshot content.
- A test proving that Browser Use cannot silently fall back to shell `open`.
- A test proving that Computer Use cannot silently fall back to Browser selectors.

## 9. Current verification evidence and its limits

The current branch has strong deterministic evidence:

- Browser slash CLI/Desktop acceptance passes with autocomplete, CDP open/type/click/screenshot/events/close and child-session routing.
- Computer slash CLI/Desktop acceptance passes with autocomplete, fixture snapshot mutations, screenshot, close and deterministic automatic tool triggering.
- Direct Browser/Computer flows pass against a real Playwright-launched Chromium CDP endpoint.
- `bun run test:httpapi` passes 357/357 scenarios.
- Core, App, TUI and Apexo typechecks pass; the push preflight reached 21/21 successful typecheck tasks.
- App and Desktop builds pass.

These results prove transport, protocol, session ownership, event persistence, deterministic fixture behavior and the current CLI/Desktop wiring. They do not prove native macOS Computer Use accuracy, real Chrome profile attachment, provider planning quality, permission behavior for direct slash commands, process-restart recovery or prompt-injection resistance.

## 10. Definition of done for a production-quality release

Browser Use is ready when:

- The user can attach to an explicitly identified Chrome target with a visible approval step.
- The model receives interactive element references, tab state and screenshots when needed.
- Every mutation has a stale-target guard, bounded wait, post-action observation and result verification.
- CLI, Desktop and model tools share permission, event and cancellation semantics.
- Browser disconnects, restarts and stale references produce recoverable UI states.
- Real Chrome, provider-loop, permission, tab and failure tests pass.

Computer Use is ready when:

- The user can see the active app/window and the exact display being controlled.
- Observation returns a screenshot and semantic accessibility targets where available.
- Coordinate fallback handles inaccessible surfaces with correct display scaling.
- Every mutation returns a screenshot/observation and postcondition classification.
- macOS permission, missing-driver, timeout, cancellation and app-close cases are explicit.
- CLI, Desktop and model tools share permission, progress, event and recovery semantics.
- A real macOS application acceptance suite passes; fixture tests remain supplementary.

The current branch meets the transport and deterministic acceptance portions of this definition. It does not yet meet the native Computer Use loop, unified permission boundary, semantic target references, persistent live-session recovery, or production-grade routing portions.

## 11. External references used for this audit

- [Playwright `connectOverCDP`](https://playwright.dev/docs/api/class-browsertype): attaches to an existing Chromium instance, exposes the default browser context, and documents that CDP attachment is lower fidelity than Playwright's native protocol connection.
- [Chrome remote debugging and DevTools Protocol](https://developer.chrome.com/docs/automation-and-testing/headless-chrome-shell): remote debugging must be enabled and the application is responsible for starting or attaching to Chrome; the DevTools Protocol is the underlying control surface.
- [Playwright MCP browser attachment](https://playwright.dev/mcp/configuration/browser-extension): the established integration pattern supports Chrome channel attachment and explicit CDP endpoint attachment, which is a useful model for Apexo's connection onboarding.
- [OpenAI Computer Use](https://developers.openai.com/api/docs/guides/tools/computer-use): the official Computer Use contract is a model/tool loop where the executor applies actions and returns observations for the next model step.
- [Anthropic Computer Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool): the executor returns screenshots for desktop actions, handles ordered tool calls, stops after failures, and requires isolation and human confirmation for consequential actions.
- [Anthropic Browser Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool): browser automation combines accessibility/page structure with screenshots, stable element references, tab state, ordered tool results, stale-reference handling and explicit security controls.

These references describe integration contracts and safety patterns. They are not runtime dependencies or a reason to vendor another product's orchestration engine into Apexo.

## 12. Recommended implementation order

The next implementation sequence should be:

1. Unify permission and progress state for direct slash commands and model tools.
2. Implement Browser element references, tab state and post-action observation.
3. Implement a real macOS Computer screenshot/accessibility loop with postcondition verification.
4. Add deterministic Browser/Computer routing and provider batch-result handling.
5. Persist live-session metadata and implement reconnect/reattach/fail-closed recovery.
6. Finish Automation UI, diagnostics and the real native acceptance matrix.

Starting with visual polish or more provider prompt wording before steps 1–3 would hide the current safety and execution gaps without fixing the underlying behavior.
