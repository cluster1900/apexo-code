# BUG-20261015-023: A dead retained transport is republished as connected

- Scope: native MCP preference implementation; found before integration.
- Status: corrected; isolated and live focused Apexo tests passed.
- Independent occurrences: one reproduced draft race.

The first draft reused a healthy connection for Connect or configuration reset.
It then waited for preference locking/writing, but publication checked only a new
candidate. The retained transport could die during that wait. The action would
save its preference and publish the old connected/tools status after the actual
child had exited.

Reproduction: keep a real healthy stdio child, hold the preference lock, begin
Connect, kill the child, wait for failed status, then release the lock. Restoring
the pre-fix publication boundary made the regression fail because Connect returned
success. Expected behavior is failure, exact rollback of the staged choice, and
truthful failed status with no dead connection presented as usable.

Enabled publication now verifies either the replacement candidate or the retained
transport immediately before synchronous publication. A failed liveness check
enters exact-revision/byte rollback and preserves newer external writes.

The paired regression reproduced this and BUG-20261015-022 as two failures before
restoring the fix. The complete isolated preference suite passed 12 tests / 104
assertions; existing native MCP regression passed 12 / 97. Commands target
`test/v2/mcp-preferences-native.test.ts` and `test/v2/mcp-native.test.ts` from the
isolated Apexo package. Live/packaged acceptance subsequently passed as described below.


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
