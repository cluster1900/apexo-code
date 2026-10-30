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

## Bug ID

`BROWSER-CDP-002`

## Affected scope

CDP target selection and manual `/browser type` actions in the CLI and Desktop surfaces.

## Observed behavior

When Chrome exposed more than one page, Browser Use attached to the first page returned by `/json/list`, even when it was unrelated to the requested URL. Manual typing focused an input and inserted text without selecting its existing value, so repeated commands appended text and could act on the wrong page.

## Expected behavior

Opening a URL must select the exact matching page, reuse only an `about:blank`/new-tab target, or create a dedicated target. Manual `type` must replace the selected control's current value. Evaluation errors must identify the failing browser expression when possible.

## Root cause

Target discovery ignored the requested URL and used the first page. The type action only called `focus`, leaving the old selection and value intact.

## Fix

CDP discovery now prefers an exact URL, then a blank target, and otherwise creates a new tab. The type action selects the input (or the contenteditable range) before `Input.insertText`; Runtime evaluation errors retain the CDP exception description. The Playwright slash fixture includes an unrelated tab and starts the input with `Old`, so both target precision and replacement semantics are covered.

## Verification

- `bun run script/browser-slash-ui.mjs cli` passes autocomplete, exact replacement, click, screenshot, event replay, and close.
- `bun run script/browser-slash-ui.mjs desktop` passes the same checks through the rebuilt Desktop renderer and sidecar.
- `bun run script/browser-computer-use.mjs cli` and `bun run script/browser-computer-use.mjs desktop` pass open, observe, type, click, screenshot, replay cursor, and close.
