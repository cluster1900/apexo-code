# BUG-20261015-329: A native Task UI fixture selected the compatibility host

- Scope: new Task message operator acceptance fixture.
- Observed: backend API admission created the native Task, but the actual terminal displayed an empty compatibility list.
- Expected: an acceptance fixture for native Task controls must expose the native server protocol used by those controls.
- Reproduction: create a native Task through the dual CLI host, then let `serverProtocol` probe its healthy legacy endpoint before mounting the native Task panel.
- Root cause: the dual host legitimately advertises legacy health. The fixture assumed that availability of `/api/session` implied native protocol selection. The empty list was not an Apexo Task message implementation failure.
- Fix: the isolated fixture starts the canonical native `webHandler` in its own process, matching the existing native Task UI fixture; it retains real configuration, permissions, persistence and provider execution. It does not fabricate Task rows or force the UI protocol selector.
- Verification: actual browser three-mode/cancellation/navigation checks and mini/fullscreen normal/narrow checks pass through the corrected host. The first independent readiness timeout during concurrent builds is not counted as this defect and has no established product root cause.
