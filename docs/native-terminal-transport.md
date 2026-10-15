# Native terminal transport

The mini and fullscreen terminals can attach to a native-only Apexo server, consume canonical Session history/events and admit prompts through the native API. Apexo remains responsible for execution, persistence, permissions and cancellation. No compatibility model loop or Grok executable participates.

## Protocol and projection

Protocol selection uses the existing health contract: a valid compatibility health endpoint selects compatibility; only its explicit absence permits native health detection. Authorization and server failures remain errors. After selection, a failed operation never retries through the other API. The internal transport factory also accepts an explicit protocol selection for a future authoritative engine selector.

The terminal host decodes canonical Session events into Core's pure in-memory message projector, then maps that state into the existing terminal presentation. History pages are chronological and cursor checked. Original event, message, tool and interaction identities are retained. Durable replay wins over late transient fragments. Reconnection restores history and blockers; it never re-admits a prompt or resumes a provider turn. No Core runtime dependency was added to Client, Schema or Protocol.

Question and permission requests retain their original Session/request IDs. Actual replies use native endpoints. Native permission “always” presentation describes saved approval; compatibility retains its existing lifetime wording. Native coordinator activity is polled by a terminal-owned loop with cleanup and stale-response checks; failed reads are not interpreted as idle.

## Supported interactions

Both terminals support existing native Session attachment, real prompts and streaming tool output, ordinary questions, Plan approval, permissions, active Stop, passive managed-child transcript viewing and catalog selection. The raw SDK remains available for existing native Task/Goal manager panels. Existing native media attachments render as saved paths without rereading previews or starting provider work.

Fullscreen uses the resolved Location carried by its native catalog response separately from Project.Current identity. Mini uses explicit/persisted selection, actual agent configuration and enabled catalog models in the same order as the existing App/terminal selection contract. Fresh creation is verified in both terminal modes.

## Explicit boundaries

- Mixed servers currently advertise compatibility health, so automatic selection remains compatibility. A native-created Session on a mixed server needs an authoritative engine marker or explicit user selection in a later slice. No Session-ID heuristic is used.
- Noninteractive native attachment remains unavailable because its deny-only approval policy has not been mapped. This patch does not silently broaden headless permissions.
- Native user-shell, configured slash-command execution, compatibility fork, remote workspace creation and synthetic editor-context attachments are rejected explicitly. They are not delegated to compatibility execution.
- Native mini stream-derived compatibility subagent tabs are absent. Native Tasks output remains available in the Tasks manager, and direct child attachment is passive. Domain-owned child mutation restrictions remain server-authoritative.
- System/compaction records stay in the canonical projector but are not invented as ordinary user messages in the compatibility-shaped terminal view.
- Other legacy-only manager operations are not made native by this transport. This is a scoped native-only terminal slice, not complete CLI/Desktop feature parity.
- Existing terminal copy is English; this slice does not claim en/zh/zht terminal localization.

## Verification

Shared integration passed the eleven-file Memory/terminal regression: 96 tests / 371 assertions, and all 21 workspace typechecks. The new TUI Schema workspace dependency was materialized through the frozen lockfile before those checks; its earlier missing-link failure is [BUG160](testing/test-fixtures/native-terminal-workspace-install.md).

All nine actual scenario groups below were then exercised against the shared sources in both terminal modes, with the same scoped check/provider counts. The first parallel permission pair timed out before native-host/terminal startup; unchanged individual reruns passed three checks / three calls each. This unresolved startup symptom remains [BUG163](testing/test-stability/native-terminal-backend-readiness.md). Every command completed and its owned processes were reaped. These terminal tests use real source hosts; rebuilt Desktop backend acceptance is separately recorded by feature.

All commands run from packages/apexo with the pinned Bun runtime unless otherwise stated. These are Apexo implementation checks, not upstream runtime tests.

- Focused canonical projection, protocol/error handling, compatibility transport/replay and boot: 60 tests / 142 assertions across five files.
- Actual native transport leaf: 4 checks / 3 provider calls.
- Mini and fullscreen ordinary/Plan/permission PTYs: each mode passed 3 checks per scenario (ordinary 3, Plan 5, permission 3 provider calls).
- Mini and fullscreen Stop: each passed 1 check / 1 initial provider call and no continuation.
- Mini and fullscreen reconnect: each passed 4 checks / 3 calls, including resubscription without repeated model work and a subsequent durable prompt.
- Mini and fullscreen media: each passed 5 checks against 10 fixture setup calls; passive attachment caused no additional provider or preview requests.
- Mini and fullscreen compatibility regression: each passed 2 checks / 1 provider call.
- Mini and fullscreen managed-child view: each passed 2 checks with no provider calls caused by attachment. The actual `/tasks` route in each terminal also passed 2 checks with no provider calls caused by the manager.
- Fresh mini and fullscreen creation: each passed 2 checks / 2 provider calls, exactly one Session at the resolved Location, one durable user message, and actual Question approval.
- `bun typecheck` passed in packages/tui and packages/apexo after owner/per-call signal composition. Packaged shared-artifact verification belongs to the integration checkpoint and is not claimed here.

Related records: [draft type boundaries](testing/types/native-terminal-draft-boundaries.md), [activity reconciliation](testing/runtime/native-terminal-activity.md), [fresh bootstrap](testing/runtime/native-terminal-bootstrap.md), [PTY expectations](testing/test-fixtures/native-terminal-pty-readiness.md), [request lifetime](testing/runtime/native-terminal-request-lifetime.md).
