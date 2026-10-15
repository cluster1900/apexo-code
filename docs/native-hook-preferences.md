# Persistent Hook choices

Apexo owns saved Hook choices, Session snapshots, dispatch and lifecycle. The implementation uses no Grok executable at runtime. Installed Grok 1.0.52 and the pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` provide comparison evidence only.

## User behavior

The Session Hooks panel and terminal `/hooks` panel show two distinct states:

- **This session** is the choice captured for that Session. A successful toggle changes this Session's effective choice immediately for its next dispatch.
- **Saved choice** is the durable global user disable. Removing that disable means “use configuration”; it cannot enable a handler disabled by configuration.

Other Sessions that already captured choices keep them until explicit reload. New Sessions capture saved choices. A changed saved choice is displayed separately, with an explanation that reload applies it. Toggles do not rediscover configuration, trust a source, start model work or increment the registry generation. Reload retains its existing safe-boundary contract.

Only a handler known in the target Session's captured registry can be changed. Unsupported, unknown-provenance and policy-managed handlers are read-only. A configured-disabled handler remains disabled. Neither API callers nor Hook configuration can manufacture managed provenance.

A handler already started keeps the dispatch's chosen set, including later handlers in the same dispatch. Subsequent dispatches see the updated target-Session choice. SessionStart and prompt receipts are retained across toggles and rebinding, preserving exactly-once behavior. Ordinary compatibility plugin chat callbacks keep their existing timing.

## Identity and storage

Host identities hash the source file and original event/group/handler slot. Installed identities hash logical plugin ID and event/group/handler slot, excluding versioned install roots. Different source roots and plugin IDs remain distinct even when their command text matches. Editing command bodies or secrets does not create a new identity; reordering slots deliberately changes which slot a choice addresses.

The global data directory contains `hooks/preferences.json`, a versioned document of disabled identities and a revision. The store uses the existing cross-process file lock, locked merge, a private atomic replacement file, and filesystem synchronization. If Session publication fails, it restores the exact previous bytes under the same lock. Cancellation joins an admitted write/publication or rollback before releasing the writer lock. Reads use an opened descriptor and a bounded buffer, capped at 1 MiB; the disabled set is limited to 4,096 entries.

A saved-state revision is independent of registry generation. Responses expose metadata, states and safe error codes; they do not return command bodies, environment values or HTTP secrets.

## Failures and ownership

A corrupt or unreadable store never becomes an implicit enable-all selection. Initial gates fail closed when an eligible user handler could be affected. Observers skip potentially affected handlers with a safe diagnostic while retaining non-veto behavior. Empty registries, unrelated events, unsupported/configured-disabled handlers and unmatched handlers do not fail merely because unrelated choices are unavailable.

A later failed saved-state read preserves the Session's previously trusted effective selection and displays the failure. Reload failure retains the previous registry and choices. Repairing storage and refreshing restores inspection; reload is required to adopt saved choices into a previously failed initial selection.

Preference selection capabilities are explicitly supplied at production registration and tied to the original Session entry and Location owner. Retained selections fail closed after invalidation. Deferred compatibility event delivery obtains the original private lifecycle claim from the direct first-party listener context; it never reacquires a replacement Session by bare ID. The delayed-event regression proves legitimate delivery and rejection after deletion/reuse. No serialized event field grants lifecycle authority.

## Public endpoints

Native and compatibility groups add `POST /api/session/:sessionID/hooks/preference` and `POST /session/:sessionID/hooks/preference`, respectively. The body is `{hookID, enabled}` and the result is the existing enriched Hook snapshot. Unknown/read-only handlers return invalid-request errors; uncaptured/conflicting ownership returns conflict; unavailable saved state returns service-unavailable. Existing Session and Location authorization remains authoritative. GET stays passive.

The snapshot reports optional preference revisions/failure plus per-handler ID, configurability, configuration state, effective state, saved user disable and pending difference. Missing optional fields are omitted on the wire. See the Schema and Protocol leaves for the exact typed contract.

## Verification

The off-tree implementation passed:

- 44 real implementation tests and 204 assertions across 12 Hook/store/event/deletion fixture files, including concurrent locked writers, exact rollback, cancellation settlement, bounded/corrupt reads, slot identity, retained receipts, fixed dispatch selection, empty/ineligible dispatch and delayed stale event rejection.
- Native CLI acceptance: six checks with ten provider requests. Management adds no provider work; the fixture verifies held-handler continuity, other/fresh Session behavior, restart, corrupt-state retention and invalid targets.
- Mini and fullscreen terminal acceptance: nine checks each, including toggling, unchanged registry generation, no model work, explicit reload and passive reopening.
- Production browser acceptance: eleven checks in English, Simplified Chinese and Traditional Chinese, including saved/effective divergence and localized controls. The private production App build and final Core, Server, Apexo, App and TUI typechecks passed.
- Installed reference: the original eight assertions passed with eight provider requests, verifying target choice, other captured/fresh Sessions, held dispatch, next dispatch and full restart persistence. The integrated reproducible `bun script/grok-hook-preferences-official.mjs` comparison passed ten checks / eight provider requests, adding explicit assertions that the held-dispatch toggle settled and made zero provider calls. Reference actions reported no required reload or restart; the observed saved-global/effective-Session distinction is made explicit in Apexo's UI.

Reproduction commands run from `packages/apexo`: `bun script/grok-hook-preferences-native.mjs cli`, `bun script/grok-hooks-tui.mjs`, `bun script/grok-hooks-tui.mjs --fullscreen`, and `bun script/grok-native-hooks-ui.mjs browser --locales`. The same backend script supports `desktop`; actual native-window verification uses the UI script's `native --locales` mode after a coordinated build. Live integration has since passed 45 implementation tests / 225 assertions across 13 files, plus two real-renderer list-growth tests / ten assertions. CLI and rebuilt Desktop each passed six scenarios / ten provider requests. The actual native window passed eleven checks across en/zh/zht, and its three captures were inspected. Client/legacy SDK generation, isolated-index generated reproducibility, all 21 typecheck tasks, and App/Desktop builds passed. The seven focused HTTP scenarios passed with no missing or extra routes. Live production browser and actual native window each passed eleven checks across en/zh/zht; mini and fullscreen each passed nine checks. Both retained terminal captures show intact controls, generation and saved/effective states. Apexo typechecking also passed after the added renderer test. The complete HTTP gate passed all 288 scenarios in each coverage, authorization and Effect-handler mode, covering 267 routes with zero failures, skips, missing routes or extras and clean process exit. The complete unit gate passed 4,036 tests, with 19 existing skips, one todo, zero failures, 53 snapshots and 13,394 assertions across 354 files. All six Turbo tasks and process exit succeeded in 14m53.582s (the package test process took 884.89s). This aggregate includes the integrated Hook preferences and preceding Workflow schema, host-permission and terminal-layout changes; OAuth, Task and sandbox drafts are excluded.

Translation terminology was checked against the maintained Mozilla Firefox Chinese preference corpora, Microsoft's localized Edge developer documentation, and Taiwan Ministry of Education entries for 啟用 and 儲存. Existing Session/configuration terminology is preserved. This is corpus-backed review, not a native-speaker certification.

## Explicit limits

Real managed-policy Hook ingestion remains unimplemented; the exemption is a trusted internal seam with source-backed tests, not a claim of managed-policy parity. Saved disables do not activate undiscovered or untrusted sources. Installed Grok's runtime is never embedded. The existing native Hook event support matrix remains authoritative; persistent choices do not add unsupported events or handler kinds.

Fixture and integration failures are recorded in [reference contract setup](testing/test-fixtures/hooks-preference-reference-contract.md), [typed error assertion](testing/test-fixtures/hooks-preference-error-assertion.md), [optional result assertion](testing/test-fixtures/hooks-preference-optional-result.md), and [private workspace construction](testing/test-fixtures/hooks-preference-private-workspace.md). Compiler boundary corrections reuse [generic Effect channels](testing/types/session-lifecycle-generic-effects.md) and [compatibility snapshot adapter contracts](testing/types/hooks-snapshot-compat-adapter.md).
