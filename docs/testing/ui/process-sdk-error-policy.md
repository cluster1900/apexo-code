# BUG-20261015-142: Process actions inherited the SDK throwing policy

- **Status:** Fixed in the private Process UI draft; shared integration is pending.
- **Occurrences:** One authoring episode.
- **Scope:** App native Process output, wait and cancel adapter, plus the existing native Task cancellation status mapping.
- **Observed:** The real browser's Process cancel request returned 409, and the manager displayed `Request failed: private fixture process cause` instead of its localized conflict message. The retained screenshot and HTTP trace agree. Earlier tests used a client without the App's global `throwOnError: true` default.
- **Expected:** Selected native action failures are mapped by HTTP status to safe localized messages; raw response causes must not reach this surface.
- **Root cause:** The adapter awaited the generated SDK without explicitly overriding the global throwing default. The SDK threw before the adapter could inspect the response and map its status.
- **Fix:** Pass `throwOnError: false` for every native action whose response is inspected. Preserve explicit throwing semantics for list requests, whose independent failures become safe list-availability flags.
- **Verification:** From `packages/app`, `bun test src/utils/session-tasks.test.ts` passed 24 tests and 89 assertions. The actual HTTP fixture uses a real client configured with `throwOnError: true`; Process output/wait/cancel each cover 404, 409, 503 and other failure mapping. From `packages/apexo`, `bun script/grok-native-process-ui.mjs browser --locales` passed seven checks with 16 setup provider requests and no additional provider work during manager actions, including the actual 409 UI correction. Native-window acceptance is recorded in the feature notes.

This is not a general claim that arbitrary compatibility errors are sanitized by this change. No same-root-cause record was found in the testing index or record content during this fix; no recurrence rule is warranted.

Shared verification: App adapter 24 tests / 89 assertions and all 21 typechecks passed. Shared production browser and actual rebuilt Desktop window each passed seven checks / 16 setup calls, with zero additional provider calls from UI actions; compatibility regression passed. All owned commands exited zero and were reaped.
