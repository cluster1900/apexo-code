# BUG-20261015-342: Task message Escape returned false and closed the parent panel

- Scope: Task message terminal editor Escape command.
- Observed: after a confirmed admission, Escape closed the entire mini Task panel instead of returning from the editor to its list. The real PTY became blank after its parent close callback exited.
- Expected: one Escape leaves the editor; a later Escape can close the Task panel.
- Reproduction: open the mini Task message editor, send to a held child, wait for the admitted receipt and enabled actions, then press Escape once.
- Root cause: the keymap command directly returned the parent callback's `setMessaging(false)` result. That boolean false indicates an unhandled command, allowing the same key to fall through to the parent's raw keyboard listener. Merely checking `defaultPrevented` did not fix the command's false return.
- Fix: the command invokes the close callback with an explicit void return. The parent also respects an already-prevented key, matching other footer panels.
- Verification: the focused real OpenTUI regression checks editor exit, zero parent close callbacks and reopening the retained draft. Actual mini/fullscreen normal/narrow delivery fixtures each leave and reopen the editor before the child proceeds; all retain the admitted receipt.
- Independent occurrences: one defect, reproduced in two attempts. Repeated attempts are not counted as independent historical occurrences.
