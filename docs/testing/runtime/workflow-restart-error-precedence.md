# Restarted Workflow recovery returned a generic busy error

- **Bug ID:** BUG-20261015-033
- **Scope:** Native Workflow resume control after a real process restart.
- **Status:** Fixed and verified in live CLI, rebuilt Desktop and renderer acceptance.
- **Occurrences:** One observed CLI failure.

The schema-correction CLI held a correction request, killed its owned server,
reopened the durable Workflow, and requested resume. No provider retry occurred,
but the response was `ConflictError: Session already has pending workflow work`.
The caller should receive the existing typed restart explanation directing it
to start a new run.

`WorkflowControl.resume` evaluated general Session eligibility before reaching
`WorkflowStore.resume`, whose process-owner check already rejected restart.
The persisted running record therefore masked its more actionable recovery
error. This is distinct from the earlier stale-stop ownership bug: this failure
never interrupted another Session or started an unauthorized provider request.

The draft adds a read-only owner check before general eligibility and shares
its pure validation with the existing atomic store resume check. Admission,
lifecycle ownership, and scheduling remain unchanged. The final atomic check
still runs; the preflight does not authorize work. An unfinished claimed schema
attempt is also refused atomically before changing paused/cancelled state or
scheduling host work. The derived `resumeBlockedReason` public projection lets
the UI show fixed localized guidance without exposing arbitrary error causes;
its enum is excluded from stored Info and is never an authorization input.
Live App and terminal acceptance also verifies that guidance and blocked Resume behavior.

Verification: from `packages/apexo`, `bun script/grok-workflow-schema.mjs cli`
passed five checks with nine provider calls after the fix. The restarted case
retained 120 known tokens with incomplete usage and returned the restart/new-run
explanation without another provider call. Store reconstruction tests exercise
both the read-only preflight and atomic resume rejection. After integration,
the focused suite passed 29 tests / 194 assertions; CLI and rebuilt Desktop each
passed five checks / nine provider calls. Production browser and actual native
window each passed sixteen checks across en/zh/zht, and each terminal layout
passed thirteen checks. The separate terminal Source-line capture symptom remains
unresolved; recovery text itself is readable.
