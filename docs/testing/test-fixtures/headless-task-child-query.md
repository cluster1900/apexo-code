# BUG-20261015-217: Headless Task fixture used a nonexistent native child query

- **Scope:** Private Phase 1 headless backend acceptance fixture, not production execution.
- **Observed:** The foreground Task test passed its first five assertions, including actual parent/child provider calls and inherited shell permission behavior, then threw `TypeError: sessions.children is not a function`.
- **Expected:** Inspect the children through the native Session service's actual public methods.
- **Root cause:** The fixture assumed a convenience method from another API surface existed on `SessionV2.Interface`.
- **Correction:** Query `SessionV2.list()` and select the entries whose `parentID` matches the fixture parent. Keep all ownership and provider assertions unchanged. Run the package typecheck before further acceptance.
- **Verification:** The corrected real native gate passed 9 tests / 124 assertions, including foreground child policy inheritance, hard denial and rejected detached admission. Core and Apexo package typechecks passed. This is one fixture authoring episode; it is not a Task implementation failure.
