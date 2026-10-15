# BUG-20261014-088: Side-question image picker retained a stale filename

- Scope: App browser and Desktop side-question dialog.
- Observed: visual inspection after a successful image question showed the previous filename in the native file input, although the submitted attachment state had already cleared.
- Expected: the picker and attachment count describe the next question consistently.
- Reproduction: choose an image, ask a side question, and inspect the picker after successful admission.
- Root cause: clearing Solid attachment state does not reset the browser-owned file input value.
- Fix: reset the input and attachment state together after successful admission, explicit clear, or rejected replacement selection. Failed question admission preserves attachments for retry.
- Verification: App package typecheck passed. The production App build with a source CLI backend passed nine browser checks, including empty file-input value after image admission. The resulting screenshot was visually inspected and showed no selected file. Native Desktop and bundled-backend browser each passed the same nine checks; the native screenshot also showed the cleared picker.
