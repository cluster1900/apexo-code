# BUG-20261112-004: Review fixtures omitted required provider usage

- Scope: initial native F01 provider fixtures.
- Observed: a syntactically valid final report was rejected with incomplete usage, including after a fabricated tool call.
- Expected: fixtures claiming a complete metered review provide usage for every provider turn.
- Reproduction: queue `TestLLMServer.tool(...)` or `.text(...)` without usage, then require a successful review receipt.
- Root cause: those convenience responses do not include usage by default. The production headless ledger correctly marked the receipt incomplete.
- Fix: attach explicit usage to successful fixture responses, including tool turns; retain a separate missing-usage rejection test.
- Verification: the native review/headless regression command passed 15 tests / 133 assertions. The real CLI suite passed 2 tests / 13 assertions, covering report JSON, priority thresholds, streaming, export and ephemeral execution.

# BUG-20261112-005: Restart fixture used an in-memory database

- Scope: native review restart/replay fixture.
- Observed: the second application graph could not find the first graph's persisted report.
- Expected: a simulated process restart opens the same isolated database and reconciles unfinished rows without provider work.
- Reproduction: construct and dispose two native graphs with the default test database while carrying a report ID between them.
- Root cause: the test preload selects an in-memory database; a Global data-directory override does not override the independently configured Database node.
- Fix: explicitly bind `Database.layerFromPath(...)` to a fixture-owned persistent database and use that same path in both graphs.
- Verification: the restart regression passed in the 15-test command; it checks captured evidence, `interrupted` status, exact retry and unchanged provider-call count.

## Other validation observations

- The sandbox denied the local fixture listener and surfaced `EADDRINUSE` for port zero. The approved local-listener test run reached the actual fixtures; no application networking fix is claimed.
- One aggregate run exhausted the default five-second deadline in the real Git fixture. These OS/subprocess tests now explicitly use a twenty-second deadline. The precise resource delay was not diagnosed; this is not evidence of a fixed Git hang. The later native/headless run passed without changing production logic to accommodate a timeout.

## BUG-20261112-012: UI fixture inherited an incompatible built-in provider model

- Scope: the F01 real browser/terminal/Desktop provider fixture.
- Observed: the first acceptance run reached the official XAI endpoint with its local dummy key instead of the owned local provider.
- Expected: every fixture model turn reaches only its local server.
- Reproduction: override a built-in provider endpoint while retaining a model whose own built-in API configuration wins model resolution.
- Root cause: the initial fixture combined an inherited legacy configuration and a native provider using a built-in model identity.
- Fix: use one native configuration and an independent `reviewfixture/review-model` identity. The live PR script explicitly selects the user's existing gh configuration directory; ordinary isolated fixtures keep credentials isolated.
- Verification: the repaired mini/fullscreen fixture each passed eleven checks; the browser and rebuilt Desktop initially passed ten checks, and the signal fixture passed SIGINT and SIGTERM cleanup. Initial line-highlighting assertions exposed a separate production defect recorded in the interface regression record.

## UI automation observations

- Finding navigation scrolls the report body. Before clicking a toolbar action, the automation now scrolls that actual action into view and checks stable enabled geometry. This changes the fixture interaction, not application click semantics.
- Terminal assertions now wait for the complete report marker and enabled action state, rather than reading partially consumed PTY rendering output.
- The first Desktop build could not resolve the remote models catalog. The subsequent production build used the build script's supported `MODELS_DEV_API_JSON` input with an existing local catalog; no runtime fallback or product change was introduced.

## BUG-20261112-015: The optional App unit runner cannot import Solid JSX

- Scope: the supplementary `packages/app` `bun run test:unit` command under Bun 1.4.4.
- Observed: after granting its required local-listener access, the command reports 85 passing tests and three import errors: `jsxDEV` is not exported from Solid's runtime. The failing entry paths are `context/sync.test.ts`, `utils/message-part-text.test.ts` and `components/prompt-input/slash-route.test.ts`.
- Expected: the App unit runner transforms Solid JSX with a compatible compiler before importing component-bearing modules.
- Reproduction: run the unmodified `test:unit` package script with Bun 1.4.4 and local listener permission.
- Root cause: Bun's direct JSX runtime import requests `jsxDEV`; the installed Solid runtime does not export it. The App's existing unit setup has no Solid JSX compiler preload. No historical recurrence or successful pre-feature baseline run is asserted here.
- Status: unresolved supplementary runner limitation. No production or unit-runner fix is claimed. The actual Vite production App build and rebuilt Electron renderer pass the F01 browser/Desktop acceptance, each with twelve checks. This command is separate from the five required repository gates.
- Initial sandbox-only listener failures were superseded by the permitted run above; they are not additional production failures.

## Follow-up validation observations

- New real-Git fixtures initially inherited global commit signing. All new/reused review Git setup commands now set `commit.gpgsign=false` per command; user/global Git configuration is not changed.
- One combined domain/CLI run overlapped root typechecking and timed out on an attached CLI request. The standalone CLI rerun passed two tests / 19 assertions. The contention was not fully diagnosed, so the passing rerun is not claimed as a product timeout fix.
- The provider-error fixture initially used the string `fixture` in its public error message, which also matched its dummy key and was correctly redacted. The fixture now uses a distinct diagnostic phrase and still asserts the safe HTTP status and explanation.
- The first explicit workspace query used an absent Effect schema helper; it now uses the actual literal-string query contract. The SDK helper uses explicit `.js` ESM imports. Root typechecking then passed all 21 tasks.

- The first own-sidecar Desktop attempts used the external-server connection key and omitted the legacy directory parameter when creating the initial Session. The fixture now uses the actual `sidecar` connection identity, authenticates with the owned sidecar credentials, and sends both native Location and legacy directory query keys. This was fixture routing correction, not evidence of a product backend failure.
- The first held-refresh terminal script tried to fetch its active report through the list endpoint after holding that endpoint. The fixture now obtains the report identity before installing the hold. Later PTY checks establish the hold and send one cancellation key; no repeated shortcut or sleep is used as readiness evidence.
