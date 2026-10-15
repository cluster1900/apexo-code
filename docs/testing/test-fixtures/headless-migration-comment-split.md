# BUG-20261015-212: Private migration bootstrap split a SQL comment

- Scope: Private headless input storage test bootstrap; canonical migrations are not changed.
- Observed: The first test failed before assertions with Bun SQLite `Statement has finalized`.
- Expected: Apply the proposed additive schema before testing actual Session/Event persistence.
- Root cause: The temporary bootstrap split SQL on semicolons without stripping its full-line comment. A semicolon in that comment produced a comment-only fragment that was passed to the real SQLite adapter.
- Fix: Remove full-line comments before splitting this controlled candidate SQL. The bootstrap is temporary validation scaffolding and must be replaced by root's canonical migration integration.
- Verification: The next run passed setup and exposed the separately recorded policy projection omission (BUG213). After that independent repair, the same actual storage test passed 1 test /26 assertions. No production SQL adapter workaround was introduced.
