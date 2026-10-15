# BUG-20261014-084: Terminal image test selected a text-only fixture model

- Scope: new side-question fullscreen PTY fixture; one observed failure.
- Observed: the real API rejected an image question after five earlier UI checks passed.
- Expected: image-capable fixture requests reach the local provider; text-only models reject images.
- Reproduction: run `bun script/grok-side-question-tui.mjs --fullscreen` with the shell fixture's default model definition.
- Root cause: that generic fixture did not declare image input capability. The production adapter correctly rejected the request.
- Fix: explicitly declare text and image input modalities for this fixture's provider model.
- Verification: real mini and fullscreen PTY reruns each pass 8 checks, including image bytes reaching the local provider. No production validation was weakened.
