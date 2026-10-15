# BUG-20261015-300: Legacy retry fixture counted a retryable transport error once

- Scope: native legacy Memory explicit retry acceptance.
- Observed: the fixture expected four provider requests but observed five after a flush response with HTTP 500.
- Expected: an explicit operation retry must use its original captured transcript; request counts must include the transport's independent retry policy.
- Reproduction: return HTTP 500 for the first legacy flush request, then perform another ordinary turn and retry the original operation.
- Root cause: HTTP 500 is retryable in the canonical LLM transport. The fixture's single-attempt expectation was incorrect; production did not resample a newer source.
- Fix: return nonretryable HTTP 400 when testing one failed request followed by one explicit retry. Production retry policy is unchanged.
- Verification: `bun test test/v2/memory-legacy-native.test.ts` from `packages/apexo` passes 8 tests and 45 assertions. The retry test checks original-source presence, later-source absence, and exactly four requests. The earlier HTTP 500 count failure remains retained in execution evidence.
