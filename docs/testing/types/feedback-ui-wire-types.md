# Feedback UI Wire Types

## BUG-20261014-044 — UI state used branded domain IDs for SDK response data

- **Status:** Fixed and verified.
- **Verified recurrence count:** 1.
- **Affected scope:** App feedback dialog type checking.
- **Observed behavior:** App typecheck rejected generated `FeedbackDraft` responses assigned to schema-domain `Feedback.Draft` state because the wire session ID is a string and the domain ID is branded. The same check caught use of an incorrect platform method name, `openLink`.
- **Expected behavior:** UI state accepts the generated SDK response and external issue forms open through the existing platform API.
- **Reproduction:** Run `bun typecheck` from `packages/app` with schema-domain draft state and the incorrect platform method.
- **Root cause:** The new UI confused decoded domain identifiers with the generated wire representation and used a nonexistent platform method.
- **Fix:** Use generated `FeedbackDraft` for response state and `platform.openExternal` for the issue-form action. Retain schema enum metadata for typed dropdown options.
- **Additional terminal integration diagnostics:** The generated API exports `FeedbackSave` rather than a standalone `FeedbackInput`, and the shared TUI component needed an explicit package export plus lifecycle option forwarding. These initial integration omissions were corrected without assertions or casts.
- **Verification:** App `bun typecheck` passed after the wire-state/platform corrections. TUI typecheck also passed after export/lifecycle fixes. The parent integrated full typecheck subsequently passed all 21 tasks.
