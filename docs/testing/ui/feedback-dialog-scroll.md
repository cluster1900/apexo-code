# Feedback Dialog Scroll Region

## BUG-20261014-049 — Feedback actions extended below the clipped modal body

- **Status:** Corrected and verified.
- **Verified recurrence count:** 1 layout defect, reproduced in native Electron and browser acceptance.
- **Affected scope:** App feedback dialog in both composer layouts.
- **Observed behavior:** With title/details entered and a feedback type selected, the action row was below the visible modal. Native automation reported Save covered by the overlay. Browser automation clicked the overlay and dismissed the dialog; no draft was saved.
- **Expected behavior:** All fields and action buttons remain reachable through an actual scroll region within the modal.
- **Reproduction:** Open Feedback on a session, fill title and details, choose a type, and attempt Save on a constrained viewport. The previous flex wrapper allowed content to extend beyond the shared Dialog body's clipped height.
- **Root cause:** The inner form used a flex-column wrapper with a viewport maximum taller than the available modal body and no minimum-height override. Its lower controls were painted outside the interactive modal body.
- **Fix:** Use a bounded block scroll region with `min-h-0` and a 60vh maximum, preserving natural field heights and spacing. The fixture also explicitly scrolls the real region to each action before clicking: agent-browser's interception guard did not automatically reveal controls inside the nested scroll region. The initial failure combined an oversized form with that automation assumption; the corrected workflow verifies actual reachability without bypassing pointer interception.
- **Verification:** Rebuilt actual native Electron and production browser with Desktop backend each passed all 12 feedback UI checks, including create/save, reload, review, real Markdown download, conflict recovery, deletion, and large-draft fallback. The native review screenshot was visually inspected. Mini/fullscreen terminal checks each passed 11 checks. No external issue was opened or submitted.
