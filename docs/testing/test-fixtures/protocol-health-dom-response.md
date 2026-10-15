# BUG-20261014-124: Native transport fixtures mixed DOM HTTP globals

- Scope: App HTTP transport fixtures; four independent native/DOM realm mismatch episodes.
- Observed: the initial real socket fixture using `Bun.serve` and global `Response.json` under the App HappyDOM preload produced HTTP parse errors and failed legacy detection. Importing Bun fetch removed parse diagnostics but legacy detection still failed, so that attempt was not a verified fix.
- Expected: the fixture serves valid JSON health responses and tests the production detector without depending on browser response shims.
- Reproduction: run the initial protocol fixture with the App package's HappyDOM preload.
- Root cause: the fixture combined the preload's DOM HTTP globals with a native Bun server. The protocol fallback hid failed probes in two native cases; their apparent passes did not establish successful transport.
- Fix: serve explicit JSON bytes and headers with `node:http`, use Bun's exported fetch, and assert the exact requested paths. The fixture closes all owned connections and its server.
- Verification: from `packages/app`, `bun test src/utils/server-protocol.test.ts` passed 3 tests and 6 assertions with no parse errors. `bun typecheck` exited successfully. No global test environment was modified.

## Second independent occurrence: native prompt adapter fixture (2026-10-15)

The new `server-native-prompt.test.ts` initially used `Bun.serve` with the HappyDOM-preloaded global `Response`, reproducing the native server's “Expected a Response object” and HTTP parse errors. An earlier OPTIONS request also exposed missing fixture CORS handling. The final fixture uses `node:http` byte responses, explicit CORS headers, and consumes POST bodies before replying. It closes the server once rather than calling Bun's `closeAllConnections` before a second close, which produced `ERR_SERVER_NOT_RUNNING` during this setup episode.

Verification: in `packages/app`, `bun test --conditions=solid --preload ./happydom.ts src/utils/server-native-prompt.test.ts src/utils/server-skills.test.ts` passes 3 tests / 18 assertions. This is the second verified independent DOM/native Response construction occurrence; the additional setup attempts do not increase that count. No rule promotion at two occurrences.

## Third independent occurrence: native media preview transport fixture (2026-10-15)

The media reader test initially combined `Bun.serve` with the App HappyDOM preload's global `Response`. Native transport reported “Expected a Response object” and `HPE_UNEXPECTED_CONTENT_LENGTH`; the initial run finished with four passes and two failures. Subsequent setup attempts also exposed a stalled abort assertion under mixed DOM/native transport. Those attempts belong to this single authoring episode; the precise DOM abort mechanism was not independently established.

The final fixture runs the actual reader in a separate native Bun child process, with real `node:http` responses, native fetch and native abort signals. It verifies authentication, Location-contained paths, redirect refusal, MIME and byte limits, and cancellation against a held response. Every owned listener closes and the child exits normally. The App test retains the ordinary preload and verifies the child exit and five transport checks; no global constructors are replaced.

Verification: `bun test src/utils/media-read.test.ts src/utils/session-message-media.test.ts` from `packages/app` passes four tests and nine assertions, including the five native HTTP checks. App `bun typecheck` passes. This is the third verified independent Response-identity occurrence, promoted to [RULE-20261015-009](../../rules/native-http-fixture-globals.md).

## Fourth independent occurrence: Scheduler action cancellation fixture (2026-10-15)

The new held Resume adapter test used exported Bun fetch but retained HappyDOM Request and AbortController through the App's package-level bunfig preload. The server received the real POST; aborting the owner did not settle the mixed-realm request within the unchanged five-second test budget. Omitting the command-line preload was not a native control, because bunfig still applied it. This was one authoring episode, not multiple historical occurrences.

The corrected test runs the actual `taskActions` implementation in a native Bun child with matching Request/fetch/AbortController and a real held `node:http` endpoint. Owner cancellation settles with the exact abort reason and sends no detail request. The App test retains its normal preload and joins the child; no globals are replaced.

Verification: from `packages/app`, `bun test --conditions=solid --preload ./happydom.ts src/utils/session-tasks.test.ts src/utils/server-native-prompt.test.ts src/i18n/scheduler.test.ts` passes 31 tests / 367 assertions. [RULE-20261015-009](../../rules/native-http-fixture-globals.md) already requires matching transport/abort realms or native-child isolation; no new rule is proposed.
