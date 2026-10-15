# BUG-20261015-297: Memory operations retained an inactive Session dialog

- Scope: App native Memory operations owner navigation.
- Observed: With a real list response held, navigation to another Session aborted the owner but left the previous Session's operation details visible in a disabled modal.
- Expected: Owner navigation closes the old Memory dialog, aborts observation and prevents delayed data from attaching to the new Session.
- Root cause: The new operations component invalidated its owner but omitted the existing MemoryBrowser dialog-close lifecycle action.
- Fix: Close the dialog after aborting the owner and disabling actions. Preserve all generation and abort guards.
- Reproduction: Open operations, hold a real list reply, navigate to a different Session, release the old reply and reopen operations.
- Verification: `bun script/grok-native-memory-operations-ui.mjs browser --locales` passed 16 checks and five actual provider calls. The native-window command with `native --locales` also passed 16 checks and five calls, including both held-list Session navigation and held-preview server navigation. Delayed responses were released after the old dialog closed; reopening did not attach the old Session receipts or review.
