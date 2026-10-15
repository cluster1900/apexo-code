# Desktop Profile Preload Type Import

## BUG-20261014-041 — App root type import changed Window.api declaration ordering

- **Status:** Fixed and verified.
- **Verified recurrence count:** 1. The renderer diagnostics were consequences of one conflicting import graph, not independent occurrences.
- **Affected scope:** Desktop main/preload runtime-profile types and renderer type checking.
- **Observed behavior:** Adding a type-only import from the app root into preload types caused Desktop's renderer to resolve `Window.api` to the optional minimal declaration exported through the app graph. Electron methods such as `storeGet` and `getRuntimeProfile` became unavailable to the type checker.
- **Expected behavior:** Desktop renderer uses the complete required `ElectronAPI` declaration.
- **Reproduction:** Import the profile state type from `@apexo/app` in `packages/desktop/src/preload/types.ts`, then run `bun typecheck` from `packages/desktop`.
- **Root cause:** The root app module brought its ambient `Window` declaration into the preload/main import graph ahead of Desktop's declaration. This was an import-order conflict, not missing runtime IPC methods.
- **Fix:** Define the structural profile state types alongside ElectronAPI in the preload type module. Main modules import those types from the preload module, avoiding the app root import. The equivalent app platform types remain local to the app; the boundary is structurally checked by the renderer adapter.
- **Verification:** Bun 1.3.14, `bun typecheck` from `packages/desktop` — passed after the type-only replacement. No runtime behavior or compiled JavaScript changed in this correction.
