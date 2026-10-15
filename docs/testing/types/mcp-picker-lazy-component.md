# BUG-20261015-335: Lazy terminal picker stored an extra function wrapper

- Scope: native MCP terminal picker, first private implementation.
- Observed: TUI and Apexo typechecks rejected the stored picker as a function returning a component rather than a component returning JSX.
- Expected: the lazy-loaded component mounts once inside the stable MCP panel root.
- Reproduction: run `bun typecheck` in `packages/tui` with `setState({ picker: () => McpResourcePicker })`.
- Root cause: an object merge stores function values directly; the extra wrapper was appropriate only for the property setter form.
- Fix: use `setState("picker", () => McpResourcePicker)` and the OpenTUI `Dynamic` renderer.
- Verification: `bun typecheck` in `packages/tui` passed; actual mini and fullscreen entrypoint acceptance each passed four checks, including resource/template selection and delivery. One authoring occurrence; no recurring rule added.
