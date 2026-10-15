# Process manager fixture assumed an unclipped footer count

- **Bug ID:** BUG-20261015-194.
- **Scope:** One native Process mini-terminal acceptance authoring episode.
- **Observed:** The fixture timed out before opening the manager while the visible 120-column footer showed `/tasks 2...g (recent)`. The actual two running process receipts were present.
- **Expected:** Establish actual command-menu readiness and verify counts through the manager/real process receipts, without requiring a responsive footer to display an unclipped phrase.
- **Root cause:** The fixture matched literal `2 running` in a deliberately width-constrained footer. This differs from the background-text false match in BUG-20261014-016 and the permission/command readiness assumptions in BUG-20261015-147.
- **Fix:** Wait for visible command chrome, verify two actual running receipts, then wait for the real Tasks menu and manager. Assertions use the current viewport, not historical terminal bytes.
- **Verification:** The corrected run opened the manager and reached actual Monitor metadata/output and passive wait. That run separately exposed BUG-20261015-195; final pure native mini/fullscreen at 120×40 and 80×24 each passed six checks, while explicit native selection on mixed hosts passed five checks in both narrow terminal modes. All manager actions added zero provider calls.

The same acceptance-authoring episode initially required all Monitor metadata in the initial 80×24 fullscreen viewport. The actual output viewport was two lines high and correctly started at its passive-read hint. The fixture now exercises the real PageDown binding to reveal each metadata/output assertion, preserving the narrow viewport. This is a separate layout assumption within this script episode, not a recurrence of the footer clipping cause. The corrected 80×24 fullscreen run passed six checks with zero UI-provider calls; captured frames show metadata and output revealed by actual scrolling.
