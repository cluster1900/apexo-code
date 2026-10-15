# BUG-20261015-112: Native media fixture appended two query delimiters

- **Type:** Test fixture; four independent authoring episodes.
- **Scope:** Native media, nested Task and completed-child Task CLI/Desktop acceptance scripts using the shared shell fixture.
- **Observed:** The first CLI attempt received HTTP 400 when querying messages. The native decoder saw `order=asc?directory=...` rather than `order=asc`; no media behavior assertion completed.
- **Expected:** The fixture queries chronological native messages with separate `order` and `directory` parameters.
- **Cause:** `grok-shell-fixture.api` appends `?directory=` and does not accept an endpoint already containing a query. The new caller passed `/message?order=asc`.
- **Fix:** The owned native media script constructs this query with `URL` and `searchParams`, then uses the actual HTTP endpoint. The shared helper and product API remain unchanged. Explicit chronological ordering is preserved.
- **Verification:** `bun script/grok-native-media.mjs cli` passed five checks with eight language-provider calls: all four media tools produced persisted outputs and ordinary continuation, and returned downloads received no provider credentials. Packaged Desktop remains pending a coordinated artifact containing the native media implementation.

See [RULE-20261015-002](../../rules/native-message-query-order.md) for the existing chronological query requirement. This query-composition failure is not another descending-order-assumption occurrence.

## Independent nested Task acceptance occurrence

The new native nested Task script passed `/message?order=asc` to the same helper,
which appended its own `?directory=`. Native query decoding correctly rejected
the malformed order before provider work. The script now uses an owned message
reader with `URL.searchParams` for separate chronological order and directory
parameters. The helper and product API were not changed. This is a second
independent query-composition episode, not a message-order assumption.

Verification: the corrected nested Task CLI matrix passed six checks with twenty provider calls, including restart and immutable-depth follow-up.

## Independent completed-child Task acceptance occurrence

The new `grok-native-task-wake.mjs` caller again supplied `/message?order=asc`
to the helper that appends `?directory=`, producing HTTP 400 with the invalid
order value `asc?directory=...`. The owned caller now builds a URL with separate
`order` and `directory` search parameters. The product decoder and shared helper
are unchanged. This is a third independent script-authoring episode; retries
within this episode are not additional occurrences.

Verification: from `packages/apexo`, `bun script/grok-native-task-wake.mjs cli`
passes steer, queue and interject, each with two child and four parent calls,
retained chronological history and a terminal exact retry. Subsequent native
message/provider projection corrections are recorded separately in
[BUG346](task-wake-wire-projection.md).

Promoted after these three independently evidenced episodes to
[RULE-20261015-020](../../rules/native-fixture-query-composition.md).

## Independent Task resume acceptance occurrence

The new `grok-task-resume.mjs` caller passed a chronological message query to the same helper, again producing HTTP 400 with `asc?directory=...`. This is a fourth independently authored caller mistake despite the existing constraint. The owned caller now constructs both search parameters using `URL.searchParams`; no product or shared-helper change was made. The first failing CLI run is retained. Corrected CLI passes four checks with seven provider turns, including backend restart and source-history immutability. Rebuilt Desktop remains pending. The existing [RULE-20261015-020](../../rules/native-fixture-query-composition.md) remains applicable; no new rule is created.
