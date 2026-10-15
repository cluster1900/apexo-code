# BUG-20261015-302: Legacy CLI fixture expected the wrong disabled-flush status

- Scope: native legacy Memory public HTTP acceptance.
- Observed: the disabled-flush assertion expected HTTP 400; the API returned HTTP 409 with `ConflictError` and `Legacy Memory is not enabled`.
- Expected: the fixture checks the existing public conflict contract and zero provider transmission.
- Reproduction: disable a legacy Session through the native Memory endpoint, then explicitly request a flush.
- Root cause: the new fixture guessed a validation status instead of following the operation conflict mapping.
- Fix: expect HTTP 409; no production error mapping changed.
- Verification: `bun script/grok-memory-legacy-native.mjs cli` from `packages/apexo` passes four checks with two ordinary provider calls and one flush call. Disabled admission adds zero calls.
