# BUG-20261015-089: Background Task reference fixture missed the wrapped parent prompt

- **Scope:** Isolated installed Grok 1.0.52 background Task comparison.
- **Status:** Corrected and verified in the isolated comparison; fixture only.
- **Independent occurrences:** One authoring episode.

## Observed and expected behavior

The active-parent comparison timed out after twenty seconds waiting for its
controlled parent provider request to start. The parent request had actually
arrived and completed. The fixture must hold that actual request so it can test
whether a child completion starts concurrent parent provider work.

## Cause and correction

The classifier used `startsWith("TASK_PARENT_ACTIVE")` on the last user message,
assuming the raw child continuation shape also described ordinary parent input.
The installed request wrapped the parent prompt in `<user_query>` tags. The
corrected classifier accepts the marker at the beginning of either the raw text
or that wrapper and requires an actual tools-enabled request. It does not count
ancillary title or dashboard requests as parent continuations.

This differs from BUG-20261014-166, where embedded prompt searches falsely counted
ancillary requests as planning/child work. Similar request-shape symptoms do not
establish a third recurrence of that exact cause.

## Verification

The corrected isolated installed comparison held the actual parent request,
released the child, and observed zero additional provider requests while the
parent remained held. After releasing the parent, it observed exactly one
 tools-enabled completion-reminder request plus one ancillary request. The
`subagent_finished` event identified the same child and reported `will_wake:true`.
The complete profile used one actual child request and twelve total requests.
The isolated process exited and was reaped. Idle, blocking-wait and explicit-kill
profiles independently confirmed one, zero and zero reminder provider calls.
Apexo implementation verification is separate from these reference observations.
