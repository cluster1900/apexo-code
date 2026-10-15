# BUG-20261014-127: Native Goal UI fixture did not decode text content parts

- Scope: native-only Goal browser provider fixture.
- Observed: the corrected production catalog allowed Goal start, but the fixture remained in planning until its worker-phase deadline. No product schema rejection occurred.
- Expected: the fixture handles native planner text content parts, writes its assigned report through the real scoped tool, then holds only the worker.
- Root cause: the new harness serialized non-string message content as JSON, escaping the report-path quotes before extracting them. It misclassified the planner as a worker and applied the deliberate worker hold.
- Fix: recursively collect actual string leaves, matching the existing native Goal execution fixture, and preserve captured provider payloads in evidence output.
- Verification: corrected real browser progressed through verified completion and real report preview/download, confirming the parsing correction. A later harness assertion raced asynchronous cleanup; the harness now waits for the report panel to settle before checking the empty API list. Full rerun pending. This is a fixture parsing failure, not evidence that native Goal planning is broken.
