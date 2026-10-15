# Native Workflow output-schema correction

## Contract

A Workflow child with `outputSchema` (saved Rhai `output_schema`) receives one
correction when its completed, otherwise successful final response is invalid
JSON or fails the original schema. There is no public retry-count option. A valid
first response needs one owned child drain; an invalid first response permits
one further drain in the same native Session, with the same model, variant,
permissions, and read-only policy. These are two owned drains, not two provider
turns: the native Session turn and tool allowance remains authoritative.

The logical agent budget reserves the child once. The original stage/task hash
and immutable input still govern replay. The correction prompt has a deterministic
input ID, and durable attempt claims precede model execution. A completed child
receipt replays without provider work. An interrupted claimed schema attempt
cannot be retried by resuming the Workflow: the resume request returns a typed
error without changing the paused/cancelled state or scheduling host work. Start
a new Workflow run. Process
restart also refuses execution under the previous process owner. Ordinary
non-schema resume behavior remains unchanged.

Provider errors and unfinished responses do not trigger schema correction.
Schema compilation happens before child creation; schemas exceeding 256 KiB,
unsupported asynchronous validation, and unavailable external references fail
there. Apexo continues to require a raw JSON value rather than extracting JSON
from prose or Markdown fences. Schema validation is never bypassed after the
second response.

## Usage and presentation

Known per-provider-call usage is merged idempotently into the Workflow total,
including failed and cancelled work. Repeated or out-of-order receipts cannot
charge twice or reopen a terminal Workflow. A correction claim durably marks
its usage unsettled before admission. This is conservative: interruption after
the durable claim but before the first provider call also leaves a lower-bound
marker, even when that attempt made no request. Old first-attempt receipts cannot clear
that marker after a crash. Optional public `Workflow.Info.usageIncomplete`
means the displayed token total is a known lower bound. It can become false when
complete late receipts arrive without changing the terminal status or result.
Private task attempt and receipt fields survive store decoding and reconstruction.

Optional public `resumeBlockedReason` is either `process_restart` or
`schema_attempt_claimed`. One store projection derives it from current process
ownership and durable claims. It is excluded from the stored Info schema and
stripped before writes, never trusted as execution authority. Completed and
failed runs omit it. Lists, individual reads, related runs, and control replies
use the same projection. The App and terminal show fixed recovery guidance,
hide known-blocked Resume, and reload authoritative state after a racing
rejection rather than parsing arbitrary server messages.

The App keeps the total visible and reuses the existing localized lower-bound
copy. The terminal keeps the total visible with its existing Goal lower-bound
wording. False or absent flags render no hint. No automatic recovery drain is
introduced by reads, renderer refresh, or restart.

## Behavioral reference

Pinned Grok source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` defines
`SCHEMA_CONTRACT_RETRIES = 1` in the Workflow schema contract. `AgentOpts` exposes
`output_schema` without a retry-count option. The host resumes the same child
for a correction and sums both attempts' usage while logical agent reservation
happens once. Apexo implements this behavior through its own Session runner,
lifecycle, prompt inbox, Workflow store, and permissions.

Installed Grok 1.0.52 was exercised with an isolated local provider. Invalid then
valid and invalid twice each produced exactly two actual child requests, one
logical agent, and ten child tokens; each run had four total requests including
ancillary requests. In the invalid-twice fixture the child reported validation
failure; the reference script explicitly passed that failure output to
`complete`, so the outer reference Workflow still completed. This observation
is not an Apexo test. Ancillary requests containing a quoted child prompt are
excluded from child counts.

## Verification scope

The integrated live-source gate passed 29 tests and 194 assertions across all
Workflow tests, three native Workflow HTTP integrations, and the native Session
deletion regression. It covers same-child correction, logical budget, completed
receipt replay, actual usage, preserved permissions/model, no-child preflight
rejection, durable claims, restart projection, and deletion cleanup.

- `bun script/grok-workflow-schema.mjs cli`: five checks and nine provider calls,
  passed on live source. Cases cover successful correction, invalid twice,
  provider error, cancellation with refused explicit resume, and actual process
  crash/reopen without another provider request.
- `bun script/grok-workflow-schema.mjs desktop`: five checks and nine provider
  calls passed against the coordinated rebuilt packaged backend.
- Coordinated Client and legacy SDK generation, generated candidate checks,
  all 21 package typechecks, and production App/Desktop builds passed.
- `bun script/grok-workflow-ui.mjs desktop --locales` and `native --locales`:
  16 checks each, passed against the rebuilt production browser and actual
  Electron window. English, Simplified Chinese, and Traditional Chinese captures
  were visually inspected with the recovery content scrolled into view.
- `bun script/grok-workflow-tui.mjs` and `--fullscreen`: 14 checks each, passed
  using the actual mini and fullscreen terminals. Pre-shutdown screen captures
  retain the 120-token total, lower-bound hint, complete new-run guidance, and
  footer without Resume. Pressing `u` did not open an editor or call the provider.
- `bun script/grok-workflow-schema-official.mjs` and `--always-invalid` compare
  the installed reference separately; each passed two checks. These are
  reference observations, not Apexo test counts.

The renderer fixtures wait for a real provider request before ordinary pause,
assert incomplete usage and zero known tokens, and check the hint. Exact completed
usage omits it. They then hold a real schema correction, pause it, verify the
120-token lower bound and typed recovery reason, and check Resume is hidden or
unavailable. Public Info is produced by the actual backend, not a synthetic UI
fixture. All owned acceptance processes exited and were reaped.

The initial screenshots showed the top of the form rather than the asserted
recovery text, and the original terminal final capture was saved after shutdown.
Fixture-only capture corrections and verified reruns are documented in
[the screenshot framing record](testing/test-fixtures/workflow-recovery-screenshot-framing.md)
and [the terminal capture record](testing/test-fixtures/workflow-terminal-capture-lifetime.md).
The separate Source-header overlap was reproduced in the actual component and corrected by retaining fixed row heights while the run list scrolls. The renderer regression passed two tests / ten assertions, both terminals passed fourteen checks, and Apexo/TUI typechecks plus the final Desktop build passed. The rebuilt backend again passed five schema checks / nine provider calls. See [the layout defect](testing/ui/workflow-terminal-fixed-rows.md).
See the [localization review](native-workflow-schema-localization.md) for terminology,
regional sources, and the explicit limits of translation coverage.

The subsequent shared Hook/Workflow checkpoint includes this feature: 4,036 unit tests passed with 19 existing skips, one todo and zero failures; all 288 HTTP scenarios passed in each of three modes. See [the implementation record](grok-build-implementation-progress.md) for counts, source scope and preserved investigations.
