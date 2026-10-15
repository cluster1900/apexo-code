# BUG-20261015-321: Native Memory window setup lost its active page

- Scope: Private native Memory UI acceptance orchestration.
- Observed: A native-window attempt reached initialized IPC, then agent-browser reported “No active page” while setting its isolated last-active route.
- Expected: The initialized native page remains available for setup.
- Reproduction: Run `bun script/grok-native-memory-operations-ui.mjs native --locales` from `packages/apexo` with the preserved private artifacts.
- Root cause: Unknown. Concurrent shared build activity was observed but is not proof of causation. The symptoms are not counted as recurrence of any prior bug and are not attributed to the Memory component.
- Fix: None claimed. Existing bounded cleanup joined the owned children. No timeout increase or ignored assertion was added.
- Verification: Earlier browser and native-window runs completed their 15 action checks. Further acceptance reruns do not by themselves establish a fix for these startup symptoms.

The subsequent unchanged native-window setup completed and its 16 UI checks passed with five provider calls. This rerun establishes acceptance for that run only; it does not establish why the earlier page disappeared.
