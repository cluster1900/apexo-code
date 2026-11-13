# F04 MCP form elicitation

F04 adds typed forms to native Apexo MCP calls using the existing Session, permission, Location and MCP lifecycle. F02 is outside this change. No new database table, orchestration runtime, per-call MCP process, URL mode or dependency upgrade is introduced.

## Delivered behavior

- Connected native servers advertise form elicitation by default; `elicitation: false` opts out per server. Both native and compatibility configuration loading preserve the option.
- Core validates the documented flat subset: text/formats and lengths, finite numbers/integers and bounds, booleans, titled single choices, multiple choices, required fields and defaults. Limits are 32 fields, 100 choices and 64 KiB schema/reply. Unsupported constraints are rejected before UI admission.
- One cancellable gate belongs to each physical Client generation. Tools capture Session lifecycle ownership and interaction eligibility only after permission/network checks. Resources/catalog calls share that gate but cannot own a form. Normal calls preserve shared server state.
- Valid forms pause the remaining active tool budget. Human waits default to five minutes; a separate fifteen-minute hard cap starts at dispatch. Both SDK timers use the remaining hard cap. Every terminal path clears timers and listeners.
- Pending responders and a bounded settled-ID cache are Location-local memory. Invalid answers leave the form pending; duplicate same-action replies are idempotent. Events contain attribution/IDs and settlement metadata, never submitted answer content. A restart has no live responder to restore.
- Mini/fullscreen TUI share one stable-root typed dock. App/Desktop use the existing question dock container. All surfaces show server attribution, deadline, editable defaults and field constraints, and require explicit submit/decline/cancel. Live list hydration restores pending forms after frontend reload and fences changed Session scopes.
- Native runner evidence permits interactive manual/auto-accepted permissions and rejects headless policies, inherited headless work, scheduled launches and missing ownership. SDK callbacks use the captured evidence.

## Acceptance evidence

| Requirement | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01         | Real stdio and StreamableHTTP SDK peers return exact string, integer, number, boolean and single/multiple-choice values. Stateful stdio/HTTP calls retain counters/PID/session identity; stateless stdio and actual sessionless HTTP also return exact typed replies.                                                                                                                                                                         |
| E02         | Core schema/reply tests cover unsupported/nested schemas, unknown fields, sizes, bounds, formats, integer coercion and invalid defaults. App/Desktop invalid submissions remain pending.                                                                                                                                                                                                                                                      |
| E03         | Two Sessions and a resource read share one stdio Client. Resource elicitation is rejected unarmed; the resource read cannot steal a tool's form.                                                                                                                                                                                                                                                                                              |
| E04         | Real SDK server cancellation, explicit decline/cancel, local interruption, queued-call cancellation and a retired generation's late form during successor work are covered. App/Desktop Session interruption closes the owned form and produces an errored tool result.                                                                                                                                                                       |
| E05         | Real SDK tests cover a human wait exceeding a short active timeout, two pauses without budget replenishment, human deadline and hard cap. Retired generations reject queued dispatch.                                                                                                                                                                                                                                                         |
| E06         | Browser and rebuilt Desktop reload the same live root/descendant request ID. A live Client watcher clears after backend restart, the stale reply returns 404, and provider work is not replayed. Explicit reconnect starts fresh server work without replaying old calls. Real API checks cover cross-Session replies, strict unknown fields, duplicate/conflicting actions and pending-owner deletion through the normal Session middleware. |
| E07         | Initialization/idle, unarmed/missing-interaction calls and a second concurrent form are rejected. Same-action duplicate replies are idempotent.                                                                                                                                                                                                                                                                                               |
| E08         | Native provider-loop tests exercise manual permission reply, permission allow, both headless policies, inherited headless child execution, verified scheduled launches and scheduled descendants. Ordinary interactive children retain eligibility.                                                                                                                                                                                           |
| E09         | Real mini/fullscreen PTYs and browser/rebuilt Desktop windows exercise editing, validation, explicit accept, Decline, Escape cancel, direct/nested Task forms, and optional prototype-named fields. Desktop uses its own authenticated sidecar.                                                                                                                                                                                               |

The sessionless HTTP fixture creates a fresh SDK transport per request and correlates only in-flight messages for its single test client. Both request and response headers are checked for the absence of `mcp-session-id`. Backend restart recovery intentionally returns no live forms; it does not replay an interrupted call. Exceptional MCP reconnection may reset server process/session state, and the user-facing error reports this.

## Verification status

The original delivery passed all five required local gates before this audit repair:

| Gate                                                  | Result                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun turbo typecheck --concurrency=2`                 | 21 successful tasks (17 cached).                                                                    |
| `GITHUB_ACTIONS=false bun turbo test --concurrency=2` | 6 successful tasks; all 18 Apexo batches passed (521 files), plus the workflow interpreter tests.   |
| Client `bun run check:generated`                      | Passed against the staged canonical generated output.                                               |
| SDK `bun run check:generated`                         | Passed against the staged canonical generated output.                                               |
| Apexo `bun run test:httpapi`                          | Coverage, auth and effect each passed 357 scenarios; zero failures, skips, missing or extra routes. |

Production App and Desktop builds passed. Real API acceptance verifies cross-Session replies, strict excess-property handling, idempotent duplicates, conflicting actions and deletion cleanup. Mini/fullscreen terminal acceptance edits every field type and verifies exact returned JSON. Browser and rebuilt Desktop acceptance also verify reload hydration and interruption; Desktop uses its own authenticated sidecar.

Composer median was 196 ms versus 225 ms before this UI change; the measured tail remains variable. See the [performance comparison](../testing/performance/mcp-form-composer.md). No general latency improvement is inferred from one comparison.

The earlier resource/attachment assumptions and scheduled-descendant failure are retained in the linked bug records with their actual causes and verification. The feature remains on `mcp-forms` for a draft PR to `main`; it is not merged. GitHub CI status is reported separately from the completed local gates.

## Bug records

- [Original-schema validation and invocation lifecycle](../testing/runtime/mcp-form-elicitation.md)
- [Typed service/component integration](../testing/types/mcp-form-composition.md)
- [Existing generator payload restriction](../testing/types/mcp-attachment-generator-payload.md)
- [Real acceptance fixture corrections](../testing/test-fixtures/mcp-form-acceptance.md)

## Audit repair verification

The existing list endpoint now accepts `includeDescendants=true`. It inspects cached live Location scopes and authoritative Session ancestry, including cross-worktree descendants, without enumerating historical children or creating new runtime services. The default per-Session listing and reply ownership checks are unchanged. Mini, fullscreen, App/Desktop and the shared SDK watcher use the viewed Session as their root. Generated Promise/Effect Client and legacy SDK contracts were regenerated through the canonical scripts.

The shared draft reader ignores inherited properties and tracks first edits through own-key enumeration. No extra banned schema names, persistence table, orchestration engine or frontend discovery framework was introduced.

Focused repair verification passed **33 tests, 0 failures, 237 assertions** across the six F04 form/client/runner/HTTP/event files. Real acceptance scripts passed for mini, fullscreen, browser App and rebuilt Desktop. The API script also passed nested/worktree discovery through Promise/Effect Client, owner-only replies and backend restart/no replay.

| Repair gate                  | Result                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Root typecheck               | 21 successful tasks (20 cached).                                                                  |
| Root unit suite              | Six successful tasks; all 18 Apexo batches, 522 files, passed.                                    |
| Client generated consistency | Passed against the staged canonical output.                                                       |
| SDK generated consistency    | Passed against the staged canonical output.                                                       |
| HTTP exerciser               | Coverage, auth and effect each passed 358 scenarios; no failures, skips, missing or extra routes. |

All five repair gates passed. Production App and Desktop builds and real four-surface acceptance passed. The fresh production composer comparison measured a 187.5 ms median after repair versus 189 ms before repair; the reported tail was 885 ms versus 1024 ms. This comparison shows no observed regression in this fixture, not a general performance improvement. See the [full comparison](../testing/performance/mcp-form-composer.md). The draft PR remains open and must not be merged during this task.

Repair records:

- [Descendant discovery and ownership](../testing/ui/mcp-form-descendants.md)
- [Optional draft fields and first-edit reactivity](../testing/ui/mcp-form-draft-properties.md)

Reproduce the surface and API acceptance from `packages/apexo`:

```sh
bun script/mcp-forms-api.mjs
bun script/mcp-forms-tui.mjs
bun script/mcp-forms-tui.mjs --fullscreen
bun script/mcp-forms-ui.mjs browser
bun script/mcp-forms-ui.mjs builtin
```

Build App and Desktop before their production acceptance scripts. All processes in these checks are fixture-owned.
