# BUG-20261113-F04-001: SDK parsing removed unsupported form constraints

- Scope: Native MCP `elicitation/create` request admission.
- Observed: SDK 1.29.0's parsed request schema strips unrecognized field constraints before the application handler. Core could therefore accept a form whose original schema included an unsupported constraint.
- Expected: Core rejects unsupported schemas before showing a form or sending an answer.
- Reproduction: Send a flat string property with `pattern` or an unknown key through the SDK request handler and inspect the schema received by Core.
- Root cause: The SDK's standard Zod object parser strips extra keys. Validating only the parsed result cannot enforce the approved subset.
- Fix: Register a request schema preserving the raw `requestedSchema`, retaining the SDK's envelope/result validation, and validate the original constraints in Core. Unknown keys, including the empty key, fail admission.
- Verification: `bun test test/v2/mcp-elicitation-form.test.ts test/v2/mcp-elicitation.test.ts` from `packages/apexo`; form validation and real SDK transport tests pass. Final suite results are tracked in the implementation checkpoint.
- HTTP boundary follow-up: A real reply with `{ action: "decline", unexpected: true }` initially returned 204 because the endpoint's struct decoder removed the unknown key before Core saw it. The reply payload now annotates strict excess-property decoding; the real API acceptance and HTTP exerciser explicitly require 400 while a pending form remains unchanged.
- Occurrences: One implementation episode with two parser boundaries; no historical recurrence is inferred.

# BUG-20261113-F04-002: Form waits and cancellation require invocation ownership

- Scope: Native shared MCP Client, resource/catalog calls, and interactive tool execution.
- Observed before F04: The fixed SDK tool timeout expires during human input; shared incoming requests have no general parent-call correlation. Releasing a cancelled call's connection for another owner could route a late form to that owner.
- Expected: Validated human waits pause only the remaining active budget; cancelled or timed-out physical connections retire before another dispatch. Non-tool requests never own a form.
- Reproduction: Use the real form fixture with a 500 ms active budget, wait 700 ms before answering, queue another Session and a resource read, then cancel an active invocation.
- Root cause: A fixed transport timer cannot distinguish active execution from human input, and the SDK callback does not carry Apexo's owner/policy context.
- Fix: One permit per shared Client generation; capture the lifecycle claim and private interaction eligibility before dispatch; pause/resume active time around validated forms; use independent human and hard deadlines. Retire on dispatched cancellation/timeout, reject queued old-client work, and never replay cancelled calls. Cancellation while waiting for the permit leaves the active owner intact.
- Verification: Real stdio and StreamableHTTP typed replies, concurrent Sessions/resource reads, queued and active cancellation, explicit reconnect, opt-out, and real-SDK short active/human/hard deadlines pass. Runner tests cover manual/allowed permissions, headless policies, headless descendants, and verified scheduled launches. The existing resource regression now asserts retirement and explicit retry instead of expecting the cancelled Client to remain connected.
- Occurrences: One feature implementation episode; this is not evidence of a recurring defect.

# BUG-20261113-F04-005: Scheduled descendants lost temporary interaction restrictions

- Scope: Native scheduled Tasks delegating another Task.
- Observed: The direct scheduled worker rejected a form, but its nested child opened one and the acceptance waited for completion until its deadline.
- Expected: Scheduled descendants remain unattended; ordinary interactive children can still request input.
- Reproduction: Set `task.maxDepth` to 2, admit a verified scheduled occurrence, have its worker call `task`, and have that child invoke the real MCP form tool.
- Root cause: The process-global Session coordinator starts drains in its captured runtime. A temporary `SessionTaskOrigin.Current` reference at the scheduled caller is not sufficient evidence for a later nested drain.
- Fix: Capture the private interaction boolean in the existing process-local Task role at launch, intersect it with the parent's captured restriction, and require that evidence for Task-owned MCP interaction in the runner. No durable provenance chain, table or new execution mode is introduced.
- Verification: The runner suite covers direct scheduled launches, scheduled descendants, inherited headless children and ordinary interactive children. Final results are recorded in the implementation checkpoint.
- Occurrences: One verified boundary failure in this implementation.

## Shared resource regression adaptation

The first complete unit gate exposed an attachment test awaiting a second read on the same Client before releasing the first. F04 deliberately serializes those operations. The test now forks the second preparation, changes the first Session's authority while its bytes are held, releases it, then joins the second. It still proves rejection of revoked bytes, independent Session authority and exact prompt retries without rereads. This is a changed concurrency contract, not a discarded security assertion.
