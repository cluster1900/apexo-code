# Native Memory catalog used ancestor scope permission

- **Bug ID:** BUG-20261015-152
- **Status:** Fixed and verified in the private draft.
- **Scope:** Native passive Memory catalog and preview authorization.
- **Observed:** A real configured `external_directory` denial for the workspace Memory root still returned its note path in the catalog. The global root was allowed and contains the workspace root.
- **Expected:** The most specific matching Memory scope owns the external-directory decision. A broader ancestor allow must not override the workspace denial.
- **Cause:** Native catalog authorization selected the first matching root from global/workspace order. A workspace path therefore matched the global root before its own scope. Exact note read/edit checks did not replace the separately required external-directory check.
- **Fix:** Select the last matching root in the fixed global/workspace sequence, checking canonical and admitted alias paths. Keep the actual permission evaluator and per-file read/edit checks unchanged.
- **Verification:** The real service regression first failed because the denied workspace path appeared alongside the allowed global note. After correction it passed: catalog contains only the global note, workspace preview fails with `forbidden`, and global preview remains readable. The three-case boundary gate passed nine assertions, including independent disable and alias-append cases. No provider calls or permission-engine rewrite were involved.

## Shared integration verification

The shared eleven-file Memory/terminal gate passed 96 tests / 371 assertions, including the six-file Memory coverage; all 21 workspace typechecks passed. Shared source CLI and freshly rebuilt Desktop each passed four checks / three provider requests. The five native Memory HTTP inventory scenarios also passed. The separate Memory-context timing observation remains unresolved and is not attributed to this repair.
