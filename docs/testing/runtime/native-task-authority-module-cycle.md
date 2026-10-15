# BUG-20261015-063: Task admission guard introduced an authority module cycle

- **Type:** Draft runtime integration defect; not integrated production.
- **Observed:** The focused batch failed during module initialization with `Cannot access 'Authority' before initialization`; zero behavior tests passed.
- **Expected:** Core Session construction and private Task decoding must initialize without importing the Permission service through a cycle.
- **Cause:** SessionV2 acquired TaskStore for its admission guard; TaskStore imported the Authority codec from PermissionV2, which already imports SessionV2. The serializable codec did not need those service dependencies.
- **Fix:** Move that codec into dependency-light permission/authority.ts. PermissionV2 re-exports the exact codec and retains its one canonical assessor; TaskStore imports the leaf directly.
- **Verification:** The isolated four-file Task gate passed 6 tests and 90 assertions after extraction. Core and Apexo package typechecks passed; real pure-native and mixed HTTP construction both reached behavior assertions. No live integration or Desktop acceptance is claimed.
