# Native permission review audit findings

Audited revision: `6f6f5b99a649f12cb7e959dc949fa17293839796`, branch `permission-review`.
The original unresolved finding is preserved below; the remediation section records subsequent fixes and verification. The [audit report](../../development/f02-audit.md) records the complete evidence and limitations.

## BUG-20261113-F02-001: Scope capture executes an unapproved repository Git wrapper

- **Priority / scope:** P1; Core permission review action capture, all frontends using native review.
- **Observed:** A pending Bash action with cwd `repository/package` and executable `repository/bin/git` caused the wrapper to run 18 times during scope capture, before any permission reply. The reviewer eventually returned `ask`; the permission was still `ask_manual`, and the wrapper's marker already existed.
- **Expected:** A custom executable wrapper must remain manual without being executed by the review's read-only scope queries.
- **Reproduction:** Create an isolated Git repository with a commit and remote. Create `package/` and an executable `bin/git` that appends a marker and delegates its arguments to the installed Git. Configure Bash to ask, enable native review, and use an actual native runner tool call with the absolute wrapper path followed by `push origin HEAD`, with `workdir: "package"`. Supply a verified operator instruction that does not authorize publication and a controlled reviewer response of `ask`. Inspect the marker before replying. The same issue reproduces by calling the production `PermissionReviewContext.bash(...).capture` directly.
- **Root cause:** `review-context.ts` rejects executables contained by the effective cwd only. A repository-owned executable in a sibling directory is outside that cwd and passes the check. `gitScope` then invokes the selected executable for purportedly read-only queries without establishing that it is a trusted Git executable.
- **Minimal correction:** Validate executable identity before any scope query can invoke it. Repository/worktree wrappers and unresolved executable identities must fall back to manual; checking only whether the executable is under the command's cwd is insufficient. Use the existing action capture boundary and real process service.
- **Verification:** The direct scope regression failed with `capture=Success`, `wrapperExecuted=true`, `queryCount=18`. The actual native runner regression independently failed with `permission=ask_manual`, `wrapperExecuted=true`, `queryCount=18`, `modelCalls=2`. Neither test sent a manual grant or performed an external push. The two harnesses demonstrate one root-cause defect, not separate historical recurrences.
- **Audit status:** Unfixed at `6f6f5b99`; no production code was changed by the audit.

The supplemental native-runner harness initially used a nonexistent `locations.provide` method. It was corrected to the existing `Effect.provide(locations.get(session.location))` boundary before obtaining the runtime evidence above. The initial harness error is not product evidence.

## Remediation (2026-11-14)

Scope capture now resolves the executable canonically and rejects executables inside any enclosing repository, including wrappers in a sibling directory of the effective cwd. Before Git scope queries, it also requires that the resolved executable match the backend's installed Git path. This prevents a custom PATH or explicit wrapper outside the repository from becoming a scope-query process. The existing cross-runtime `which` helper keeps the same boundary in Bun and the Node Desktop sidecar.

`test/v2/permission-review-scope.test.ts` verifies repository sibling and external wrappers through explicit paths and custom PATH values; no marker is created. `test/v2/permission-review.test.ts` exercises a real native Bash action and verifies manual fallback, no wrapper execution and exactly one provider call for the main tool proposal, with no reviewer call. The ordinary local Git publication and changed-scope regressions still pass.

The combined review, scope, protocol, terminal-render, event and HTTP command passed **66 tests / 360 assertions**. Complete repository gates and rebuilt Desktop verification are recorded in the implementation report after the final runs. The original 18-execution evidence above remains historical.
