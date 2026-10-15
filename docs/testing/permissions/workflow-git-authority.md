# BUG-20261015-047: Workflow Git evidence let Session grants override configured denial

- **Scope:** Native Workflow `git_diff_since` host operation.
- **Status:** Fixed; CLI, rebuilt Desktop and native HTTP regression verified.
- **Occurrences:** One independently reproduced product defect.
- **Observed:** A restricted agent's Git diff omitted a denied file initially. After adding a broad Session `read: allow` grant, the same Workflow host operation returned that file's changed content. Template reads continued to reject the configured denial.
- **Expected:** Configured agent denials remain authoritative even when a Session or saved grant is broader. Host-only operations must use the same authority as ordinary native permission checks.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-workflow-host.mjs cli` on the preceding implementation. The fixture commits public and denied files in its private repository, changes both, adds the Session grant through the compatibility API, then requests a native Workflow diff. The `git-diff-preserves-agent-denial-despite-session-grant` assertion fails.
- **Root cause:** Workflow manually flattened agent and Session rules through `PermissionV2.evaluate`, whose last matching rule won. That bypassed the service's configured-denial boundary and omitted its saved-rule snapshot. This is distinct from including unfiltered transcript summary metadata in Goal evidence.
- **Fix:** Obtain the authoritative read-only evaluator from `PermissionV2.Service.inspect(parent.id, agent.id)` and use it for each candidate Git path. The shared evaluator retains configured denials, Session rules, and saved approvals; no new permission engine or grant is introduced.
- **Verification:** The fixed CLI and rebuilt Desktop commands each passed six checks with zero provider calls. They cover content filtering before/after Session grants, lexical and resolved-template denial, traversal, invalid Git arguments, and unchanged Git index bytes. Core typecheck and Desktop build passed. The installed-reference `bun script/grok-workflow-official.mjs --host` passed three host-operation checks with one ancillary provider request; it is comparison evidence, not validation of Apexo's authority policy.
- **Constraint:** None; below the recurring threshold.

The live `bun test test/e2e/v2-workflow.e2e.test.ts` gate passed two tests /
24 assertions, including a real native Workflow after a compatibility Session
grant. No model request or child Session was created. The subsequent Apexo
package typecheck also passed.
