# Native Workflow template and Git host operations

Apexo executes these operations inside its own Workflow host. Neither operation
creates a child Session or consumes a logical agent reservation.

`render_template(name, vars)` reads a single filename under the Location's
`.apexo/workflows/templates` directory. Both the lexical path and resolved target
require native read permission. Traversal is rejected. Files exceeding one
million bytes are rejected before reading; this is not a claim of a separately
bounded expansion or race-proof filesystem sandbox. `{{name}}` placeholders use
string values directly, JSON for other values, and `null` for a missing value.

`git_diff_since(commit)` accepts a full hexadecimal commit ID and captures tracked
changes through Apexo's existing read-only Git evidence service. It preserves the
index, disables external diff/text conversion, and filters paths through the
native permission service. A broader Session grant cannot override a configured
agent denial. Untracked file content is not included. This operation inherits
the evidence service's bounded capture; it does not provide complete arbitrary-size
diffs or whole-agent filesystem isolation.

## Reference boundary

The pinned Grok source uses an in-memory template catalog with `{name}` placeholders;
its normal Session construction supplies an empty catalog. Installed 1.0.52
rejects the unknown template used in the comparison. There is no demonstrated
installed user-template filesystem interface to migrate. Apexo's existing local
template directory and double-brace syntax are its own supported contract.

The installed Git host operation returns the changed tracked content and rejects
option-like revisions. Its source allows broader alphanumeric revisions than
Apexo's full-hash input and directly executes Git diff. The comparison does not
claim that it implements Apexo's per-path permission filtering. Preserving
Apexo's authority remains required independently of the reference.

## Verification

From `packages/apexo`, `bun script/grok-workflow-host.mjs cli` and `desktop`
each passed six checks with zero model requests. Cases cover string/JSON/missing
substitution, lexical denial, denied resolved symlink target, traversal, Git
filtering before and after Session grants, invalid options, and byte-identical
Git index preservation. Desktop was rebuilt after the permission repair; Core
typecheck passed. There is no new App/TUI interaction in this slice.

`bun script/grok-workflow-official.mjs --host` passed three checks on isolated
installed Grok 1.0.52: Git host output, unknown-template rejection and invalid
Git option rejection. It made one ancillary model request and no Workflow child
request. This is reference evidence only. All fixture processes were reaped.

The configured-denial defect and its regression are recorded in
[BUG-20261015-047](testing/permissions/workflow-git-authority.md).
