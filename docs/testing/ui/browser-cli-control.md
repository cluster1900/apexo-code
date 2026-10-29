# CLI Browser control coverage

## Bug ID

`BROWSER-CLI-CONTROL-001`

## Affected scope

The CLI branch of `packages/apexo/script/browser-computer-use.mjs`.

## Observed behavior

The initial acceptance script started Chromium with a CDP port, but its browser open, observe, type, click, screenshot, replay, and close requests were made directly with the fixture's JavaScript HTTP helper. The CLI process only performed a session-list request, so the test did not prove that the CLI could invoke Browser control.

## Expected behavior

The CLI acceptance path must issue the Browser API requests through `packages/cli/src/index.ts api`, while Desktop may continue to use the fixture helper. The CLI fixture must run the V2 CLI server with its normal daemon registration so the CLI process reaches the same Browser service. The assertions must also inspect the live page after type and click so a screenshot artifact alone cannot make the test pass.

## Reproduction

Run:

```sh
bun script/browser-computer-use.mjs cli
```

Before the fix, only the session-list request was executed by the CLI process.

## Root cause

The test reused the fixture helper for the Browser flow and used the CLI only for a smoke-test GET. This validated the server API and screenshot artifact, but it did not validate CLI transport or CLI Browser control.

## Fix

The CLI branch now starts the V2 server through the CLI's `serve --register` path, sends session and Browser requests through the real CLI API command, and verifies the live Chromium DOM after type and click. The Browser service remains the component that sends CDP commands; Playwright is used only to launch the fixture browser and observe its resulting state.

## Verification

The initial CLI and Desktop Browser acceptance scripts were rerun after this change. Each path reports 15 durable events, a PNG artifact, a replay cursor, and a closed Browser session; the CLI path additionally exercises every Browser request through the CLI command. The slash-command acceptance script below reports 12 events for its shorter command sequence.

## Follow-up bug ID

`BROWSER-CLI-CONTROL-002`

## Follow-up observed behavior

Back-to-back `/browser type`, `/browser click`, and `/browser screenshot` submissions could overlap. The next action could then carry the previous page snapshot hash and be rejected with `The page changed; observe it again before acting`, even though the prior action had already changed the page.

## Follow-up root cause

Slash command handlers returned immediately after scheduling an asynchronous Browser request. The controller updated its page cursor only when each request completed, so concurrent submissions raced over the same in-memory cursor.

## Follow-up fix

CLI and Desktop Browser controllers now serialize commands through a per-session promise queue. Each action updates the page ID and snapshot hash before the next action is sent to the Browser service.

## Follow-up verification

`bun run script/browser-slash-ui.mjs cli` and `bun run script/browser-slash-ui.mjs desktop` both pass with a real Chrome CDP port. Each path drives `/browser open`, `type`, `click`, `screenshot`, and `close`; the fixture DOM confirms the input and click result, and the event replay contains the screenshot artifact event.

## BROWSER-CLI-CONTROL-003: unavailable CDP fixture depended on an unused default port

- Affected scope: HTTP API browser-open exerciser.
- Observed behavior: `v2.browser.open.unavailable` expected a 503 while omitting `cdpUrl`; on a developer machine with Chrome listening on the default CDP port 9222, the real implementation correctly connected and returned 200, so the test failed.
- Expected behavior: the unavailable-CDP scenario must remain deterministic regardless of other local Chrome processes.
- Reproduction: run `bun run test:httpapi` while a Chrome instance is listening on `127.0.0.1:9222`.
- Root cause: the fixture relied on the implementation's default CDP endpoint rather than reserving an explicitly unavailable endpoint.
- Fix: set `cdpUrl` to `http://127.0.0.1:1` in the unavailable-open scenario.
- Verification: rerun `bun run test:httpapi` after the fixture change; the browser route remains covered without depending on host port 9222.

## BROWSER-CLI-CONTROL-004: parity scanner missed runtime-injected CLI command

- Affected scope: CLI/Desktop slash-command parity test.
- Observed behavior: the parity test reported `browser` as Desktop-only after the command was added to both surfaces.
- Expected behavior: parity coverage must include commands that the CLI injects when runtime Browser actions are available.
- Reproduction: run the Apexo test suite after registering `/browser`; `test/parity/slash-commands.test.ts` fails with `browser` in the Desktop-only set.
- Root cause: the scanner only recognizes static TUI `slash:` registrations, while the CLI Browser command is appended to the footer command catalog from runtime actions.
- Fix: explicitly add the runtime-injected `browser` command to the CLI side of the parity fixture with a comment documenting the dynamic registration.
- Verification: rerun `bun test test/parity/slash-commands.test.ts` and the full CLI/Desktop acceptance scripts.

## Unresolved symptoms

None for CLI or Desktop Browser slash-command coverage.
