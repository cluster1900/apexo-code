# BUG-20261015-283: Task comparison assumed headless output contained only parent text

- Scope: isolated installed Grok Task comparison fixture; no Apexo runtime change.
- Observed: the default-depth scenario exited zero and had no grandchild request, but the fixture expected JSON `text` equal to `ROOT_DONE`; the actual value was `CHILD_DONEROOT_DONE`.
- Expected: classify actual parent/child requests and verify completed child output through the parent's tool receipt, while recording the installed output aggregation contract.
- Cause: the fixture reused a parent-only text expectation from a headless scenario that had no subagent. Installed headless JSON aggregates text observed from the child and parent.
- Fix: inspect the actual parent tool receipt containing completed child output and record the aggregate JSON text. Do not infer child execution from raw tool arguments or change Apexo's existing output contract to match this reference representation.
- Verification: the corrected installed probe passed default-depth, configured-depth-two and enabled-active-message-catalog scenarios, with eleven conversation and seventeen auxiliary requests. The default child lacked Task; depth two executed one grandchild; the active-message feature changed the advertised catalog. All child processes and provider listeners were reaped.
- Limits: this probe verifies active-message advertisement, not delivery itself. The separate title wire-protocol assumption is recorded under existing BUG-20261015-059, not counted as a recurrence here.
