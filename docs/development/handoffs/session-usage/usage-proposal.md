# Smallest Session usage CLI proposal

This is a proposed read surface only. No source mutation is authorized by this document. It closes the confirmed CLI query gap without adding provider execution, modifying usage settlement, importing historical context as new charges, or introducing a cost calculator.

## Surface

`apexo usage <sessionID> [turn] [--attach URL] [--session-protocol auto|native|compatibility] [--dir PATH]`

Always print structured JSON. With no turn selector, return the Session identity, selected backend, observed sequence/time boundary, all recorded turn rows and a per-model summary. With a positive turn selector, return that row alongside the Session summary. Invalid Session, no recorded usage and missing turn are distinct nonzero errors. Keep diagnostic output on stderr. Never issue prompt/resume/wake, create a Session, or silently fall back to a different backend after selecting one.

Reuse existing authentication and `sessionTransport` capability selection for attached servers. For local native reads, use `createNativeLocalHost` and the current generated client over its in-process fetch; close it through existing disposal. For compatibility-local reads, reuse the existing CLI Effect bootstrap and Session service, as `stats`/`export` do. Keep native and compatibility records explicitly tagged so users do not confuse legacy projected-message statistics with the native durable event ledger.

## Authoritative inputs

Native:

- Read existing `session.get` and paginated `session.history` (Protocol already exposes public durable Session events); do not use `session.context`, which omits pre-compaction history.
- `SessionEvent.Step.Started` carries assistantMessageID, Agent and model. `Step.Ended` carries the persisted cost/token categories and finish. Pair only matching actual start/end events from this Session. Read `Step.Failed` and input settlement incomplete markers when available; do not invent zero usage for unfinished provider work.
- A distinct settled assistant/provider step is the smallest canonical durable reporting row. Grouping it into user-request turns must use canonical prompt promotion/history boundaries, never a coordinator drain or current mutable Session state. Label both user-input turn and provider-step identities explicitly. Multiple model calls during one input form one user turn with separate steps; model changes are reflected by their Started records.
- Count a canonical settlement once. HistoryCopy.Message carries imported transcript context, not a newly billed Step.Ended, and must contribute zero new calls/tokens to the resumed Session's billed rows. Preserve any displayed historical context separately. Do not recurse into child Sessions or fold Goal receipts into parent totals: those are separate billing owners and would double count ordinary child accounting.
- Report the observed durable sequence boundary. Handle repeated/nonadvancing cursors as errors. A live Session's result is an observed ledger snapshot, not a promise that no later event can arrive. If strict frozen pagination is needed, use one bounded Core database read; do not add a second event reducer just to infer it.

Compatibility:

- Existing `Session.Service.messages` / message pagination already exposes assistant `cost`, `tokens`, providerID/modelID and parent user ID. Use those persisted values exactly; do not call `Session.getUsage` again, since it computes pricing from provider response/model configuration at settlement time.
- Group by persisted user parent ID and preserve provider-step identity. Compatibility projected history can be reverted/removed; label it as recorded projected-history usage, not an immutable lifetime billing ledger. If stronger lifetime accounting is desired, that is a separate persistence contract, not part of this CLI adapter.

## Cost and completeness limits

The native runner currently publishes `cost: 0` for Step.Ended (`packages/core/src/session/runner/llm.ts:612`). Therefore native output must explicitly mark monetary costing as unsupported/unavailable rather than imply the provider was free. Preserve recorded token categories. Adding native pricing is outside this slice. Legacy persisted positive/zero costs are reported as recorded; avoid changing or recomputing them against today's model prices.

Imported history, compaction context and provider settlement are different concepts. Current Desktop `SessionContextTab` already shows context usage and raw per-message data; its latest-assistant total is not a Session lifetime total. This CLI work does not require a new Desktop layout. A rebuilt Desktop backend can validate the same read data via the existing native API, with the current context UI acceptance retained as its separate boundary.

## Implementation size and validation

Expected production scope: one CLI registration and command module, one narrow read/report module, and (only if needed for reuse) one Core pure reporting helper over canonical settled records. No new public endpoint or Schema change should be necessary for the first CLI surface; no generated-client change, new usage table or new billing engine is proposed. If exact turn grouping cannot be established from the existing records, pause for review rather than emit misleading totals or infer a drain identity.

Meaningful focused cases: two inputs with multiple provider steps and model change; imported-history resume excluded from fresh billing; manual compaction boundaries retained; incomplete/failed provider step marked; exact duplicated history delivery deduped; missing Session/no usage/missing turn; compatibility persisted values unchanged. Verify actual source CLI against native and compatibility isolated data, and the rebuilt Desktop native backend using the same fixture data. Installed reference already proves the read command; extend its existing isolated fixture read to `[TURN]`, not another provider run. Do not claim pricing, child aggregation or full-history restoration beyond those tests.
