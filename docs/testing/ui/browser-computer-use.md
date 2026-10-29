# Browser Computer Use Acceptance Record

## Bug ID

`BROWSER-CLI-FIXTURE-001`

## Affected scope

The Browser/Computer Use acceptance fixture under `packages/apexo/script/browser-computer-use.mjs`.

## Observed behavior

The first acceptance run could not create the V2 Session. The server returned `InvalidRequestError: Missing key at ["model"]["id"]` because the fixture sent the legacy `{ providerID, modelID }` model shape to the V2 session endpoint.

## Expected behavior

The fixture must send the V2 `Model.Ref` shape with `providerID` and `id`, then exercise the Browser API against the created Session.

## Reproduction

1. Run `bun script/browser-computer-use.mjs` from `packages/apexo`.
2. Observe the POST `/api/session` response.

## Root cause

The fixture mixed the legacy session model field name (`modelID`) with the V2 HTTP schema (`id`). This was a test fixture configuration error; the Browser service did not receive a request in the failing run.

## Fix

The fixture now sends `{ providerID: "xai", id: "grok-4.7" }`, matching `@apexo/schema/model` `Model.Ref`.

## Verification

`bun script/browser-computer-use.mjs` passes against the real CLI server and Playwright Chromium CDP endpoint. It verifies open, observe, type, click, screenshot artifact creation, durable event replay and cursor head, and close.

## Remaining limitations

The record does not claim that a provider-generated Browser tool call was exercised; the acceptance path calls the same V2 HTTP surface directly. Provider tool-loop coverage remains part of the follow-up CLI/Desktop fixture work.
