# Browser and Computer Use

## Scope

Issue #178 adds a Location-scoped browser controller to the V2 runtime. Apexo owns the session lifecycle, authorization boundary, durable event stream, artifact storage, and HTTP contract. Chromium remains an external runtime reached through its DevTools Protocol (CDP) endpoint.

The controller supports opening a page, observing page text and accessibility labels, clicking and typing with CSS selectors, dispatching keys, scrolling, closing a browser session, and capturing PNG screenshots. Every browser session belongs to one Apexo Session and is filtered by that owner at the HTTP boundary.

## Runtime contract

`Browser.Service` is provided by `LocationServiceMap`. It keeps the live CDP connection process-local and persists lifecycle evidence through `EventV2.Service`. A browser session receives a `brw_` ID, each page receives a `page_` ID, each action receives an `act_` ID, and each screenshot receives an `art_` ID.

The first observation returns a page snapshot containing URL, title, a bounded body-text projection, accessibility labels, recent console lines, and an FNV snapshot hash. Mutating actions may include the page ID and snapshot hash returned by the previous observation. A changed target or hash fails with `stale_target`, which forces the caller to observe again before acting.

The CDP endpoint accepts HTTP, HTTPS, WS, or WSS URLs. HTTP endpoints are discovered through `/json/list`; when no page target exists Apexo requests `/json/new`. Page navigation is restricted to HTTP and HTTPS URLs. CDP requests have a bounded timeout and translate transport failures into typed browser errors.

Screenshots are written below the active Location directory at `.apexo/browser/<browserSessionID>/<artifactID>.png`. The action response contains artifact metadata and base64 data for clients that need an inline attachment. The durable artifact event contains metadata only.

## Durable events and replay

The following version-1 events use `browserSessionID` as their aggregate:

- `browser.session_started`
- `browser.page_changed`
- `browser.action_started`
- `browser.action_completed`
- `browser.artifact_created`
- `browser.approval_required`
- `browser.disconnected`
- `browser.closed`

`GET /api/session/:sessionID/browser/:browserSessionID/events` reads the aggregate after an optional numeric sequence and returns the bounded page plus `{ earliest, head, next }`. The cursor is a replay position, not an execution ownership token. The endpoint checks that the browser session is live in the current Location and belongs to the requested Apexo Session before reading events.

## HTTP and SDK endpoints

- `GET /api/session/:sessionID/browser` lists browser sessions owned by the Session.
- `POST /api/session/:sessionID/browser` opens a page. The payload is `{ url, cdpUrl? }`.
- `POST /api/session/:sessionID/browser/:browserSessionID/action` executes an action payload.
- `POST /api/session/:sessionID/browser/:browserSessionID/close` closes the session.
- `GET /api/session/:sessionID/browser/:browserSessionID/events` replays durable browser events.

The generated TypeScript and Effect SDKs are regenerated from the Protocol definitions. Clients must pass the Session ID on every request; browser IDs alone are never sufficient for ownership.

## Authorization

The V2 `browser` tool requests the `browser` permission for observation and screenshots and `browser_destructive` for navigation, click, type, key, scroll, and close. The permission source includes the tool call identity and the requested URL or browser session resource. The service also validates ownership and target freshness independently of permission state.

## Failure behavior

Invalid page URLs and malformed action arguments map to `400`. Missing or stale browser targets map to `409`. CDP disconnects, discovery errors, and artifact write failures map to `503`. A close of an already removed process-local session is idempotent at the service boundary only after ownership has been checked by the HTTP handler.

## Verification

`packages/apexo/script/browser-computer-use.mjs` launches the real CLI server, starts a real Playwright Chromium instance with a CDP port, opens a local page through the V2 API, observes it, types, clicks, captures a screenshot, replays the durable event cursor, and closes the browser session. The same API is exposed to the Desktop sidecar because Desktop and CLI use the shared Server HTTP API.
