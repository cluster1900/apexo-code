# BUG-20261014-059: Rhai exit values leaked as ordinary completion results

- Scope: First-party Apexo workflow language adapter.
- Observed: Two adapter tests failed: pause emitted complete, and complete wrapped the requested output in an internal marker object.
- Expected: Pause remains terminal even inside a script catch; completion returns the exact user result.
- Reproduction: Run `cargo test --locked` from `packages/workflow-script` with a script using pause inside try/catch and a script calling complete after parallel host work.
- Root cause: Rhai turns its non-catchable Exit control flow into an ordinary successful evaluation value. The initial adapter inspected only error results for its marker.
- Fix: Store terminal state in a private adapter-owned cell and use Exit only to terminate evaluation. The emitted outcome is taken from that cell, so script-returned objects cannot impersonate control markers.
- Verification: Initial run had one passing and two failing tests. Corrected `cargo test --locked` passed all three first-party adapter tests.
- Occurrences: One adapter implementation failure; no upstream tests count as Apexo evidence.
