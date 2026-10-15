# BUG-20261014-106: Environment comparator expected a noncanonical workspace path

- **Scope:** Installed-reference hook environment fixture on macOS.
- **Observed:** The new environment assertion compared a temporary workspace path through the system symlink with the canonical path emitted by the official runner and failed.
- **Expected:** Compare the runner workspace identity with the real workspace path.
- **Reproduction:** Run the installed Hooks comparator on macOS using its normal temporary directory setup.
- **Root cause:** The fixture assumed the directory spelling returned by temporary-directory creation was canonical.
- **Fix:** Resolve the workspace with `realpath` for CLAUDE_PROJECT_DIR; preserve the supplied spelling for GROK_WORKSPACE_ROOT. Inspection of the isolated hook output confirmed that these two installed-runtime values use different spellings of the same directory. The initial correction incorrectly canonicalized both assertions and failed again; it was part of the same fixture correction, not an independent root-cause occurrence.
- **Verification:** Corrected isolated installed comparator passed all 15 scenarios.
- **Occurrences:** Four independent fixture-authoring episodes. Constraint: [RULE-20261015-017](../../rules/canonical-filesystem-fixture-paths.md).

## Independent Workflow host fixture occurrence

The Workflow template fixture configured a deny using the temporary-directory
alias spelling of an external file. The runtime correctly checked its resolved
path, which did not match that literal rule, so the linked template read was
allowed. A diagnostic rerun identified `linked.txt` as the failing case; it was
the same episode, not another occurrence. As in the original environment fixture,
setup had incorrectly assumed the temporary path was canonical.

The fixture now resolves the external target before writing its deny rule.
`bun script/grok-workflow-host.mjs cli` and its `desktop` counterpart each passed
six checks after the independent product permission correction. The linked
template is rejected without changing runtime path semantics.


## Independent private Task checkpoint audit occurrence

The advanced native Task checkpoint copied a coherent source tree and remapped
workspace dependency links into it. Its identity audit called `Path.resolve()`
on the dependency target but compared that result with the noncanonical spelling
of the expected temporary root. On macOS those spellings resolved through the
system temporary-directory symlink, so the assertion failed although the link
already targeted the correct private package. This was an audit-helper defect;
no production or dependency repair was required.

The corrected audit canonicalizes both the actual target and expected workspace
root. A fresh complete before/after source manifest comparison passed for 5,700
files, and all four inspected Core/Schema/Apexo/TUI/SDK workspace identity checks
passed. The actual workflow interpreter hash was retained. Three concurrently
changed documentation files were refreshed before that final full comparison;
no production, generated or package-manifest mismatch was present. This is one
independent authoring episode, not an additional mixed-revision product failure.

Verification used the checkpoint's Python source-hash and dependency-identity
audit, including `Path.resolve()` on both operands. The supplied spelling must
still be retained when an API/environment contract explicitly exposes it; this
correction concerns filesystem identity, not rewriting wire values.


## Independent native LSP workspace acceptance occurrence

The workspace activation CLI fixture supplied a temporary external workspace and
compared its URI spelling directly with `initialize.rootUri`. The native service
correctly resolved that directory to its canonical identity before authorization
and initialization. On macOS the temporary directory spelling passed through a
system symlink, so the comparison failed after the server had already returned a
successful hover result. This is the same mistaken assumption about temporary
path identity, independently authored in the workspace LSP fixture.

The expected URI now uses `realpath(workspace)` before `pathToFileURL`. Runtime
canonicalization and permission checks remain unchanged. The original failed
comparison is retained; final CLI/Desktop results are recorded with BUG365.
