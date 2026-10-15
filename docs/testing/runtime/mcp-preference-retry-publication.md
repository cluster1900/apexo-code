# BUG-20261015-022: Retry publishes across a concurrently saved disable

- Scope: native MCP preference implementation; found before integration.
- Status: corrected; isolated and live focused Apexo tests passed.
- Independent occurrences: one reproduced draft race.

The first draft read the saved choice before asynchronously starting a retry
candidate, then published that candidate using the old snapshot. A second process
could save disabled while startup was held. Retry incorrectly succeeded although
it must not change or bypass the latest explicit saved choice.

Reproduction: start a healthy server, hold a real replacement stdio child's
startup, save false through a second store instance, release startup, and await
Retry. With the pre-fix boundary restored in the isolated copy, the regression
assertion failed because the action succeeded (`Expected true, received false`
for failure exit). This was not inferred from a passing rerun.

The fix reads the latest choice under the same cross-process lock used by writes,
checks it, then synchronously verifies/publishes the candidate before releasing
the lock. A newly disabled choice rejects the candidate, updates observed choice
metadata, and retains a previously healthy runtime until an explicit successful
action or reload. No saved bytes are changed by Retry.

Verification from the isolated package copy:
`bun test test/v2/mcp-preferences-native.test.ts` passed
12 tests / 104 assertions. The paired pre-fix run reproduced this race and
BUG-20261015-023 as two failures; restoring the corrected boundaries passed both.
Full existing native MCP regression passed 12 tests / 97 assertions. Live and packaged acceptance subsequently passed as described below.


Live integration verification on 2026-10-15: the preference and existing native
MCP suites passed together, 24 tests / 201 assertions. Live CLI persistence
acceptance passed 11 scenarios / nine provider requests. The terminal action
surface passed nine checks each at narrow and expanded sizes, including safe
storage-error feedback, retained healthy tools, and error removal after repair.
Packaged Desktop controls subsequently passed 11 scenarios / nine provider
requests. Production browser and actual native window each passed 16 checks in
en/zh/zht with no provider work. Exact-byte repair removed localized inline
storage failure while retaining healthy tools. These broader checks complement,
but do not replace, the focused race/cancellation tests.
