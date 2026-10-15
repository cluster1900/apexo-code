# BUG-20261015-024: Preference lock acquisition masks cancellation

- Scope: native MCP preference implementation; found before integration.
- Status: corrected; isolated and live focused tests passed with real filesystem locks.
- Independent occurrences: one draft acquisition mistake.

The initial store acquired its cross-process lock through `Effect.acquireRelease`.
Acquisition is uninterruptible there. Canceling a management action blocked on a
held preference lock waited for the five-second acquisition timeout. The focused
assertion observed 5069 ms where less than 2000 ms was expected.

The new acquisition registers scoped ownership before restoring interruption.
Its AbortController cancels a waiting acquisition; the finalizer joins the promise
and releases the exact lease if acquisition wins the abort race. Saving and
synchronous publication retain their separate uninterruptible transaction.
After publication, retirement is ensured even if cancellation arrives.

Reproduction/verification use an actual held Flock lease and real MCP transport.
The waiting action now cancels promptly without changing saved bytes or runtime
state. A second case cancels after the acquired lock enters its callback, then a
new writer acquires immediately, proving release of the acquired lease. The
isolated complete preference suite passed 12 tests / 104 assertions. Existing
native MCP tests passed 12 / 97. Core source/test types passed before final
handoff; live and packaged validation subsequently passed as described below.


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
