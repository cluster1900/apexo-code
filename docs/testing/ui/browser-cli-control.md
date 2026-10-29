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

The CLI and Desktop Browser acceptance scripts were rerun after this change. Each path must report 15 durable events, a PNG artifact, a replay cursor, and a closed Browser session; the CLI path additionally exercises every Browser request through the CLI command.

## Unresolved symptoms

None for CLI Browser transport coverage.
