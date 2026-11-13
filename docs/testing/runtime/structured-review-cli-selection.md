# Structured review CLI selection audit

Audited on 2026-11-13 against `adfce4eca88d887ca0a02f4dfeb3d5fb0d16bd3e`.
The findings below describe the audited revision; subsequent fixes are recorded under Remediation. Each finding represents one
independent audit episode. Normalized runtime evidence is in
[the audit evidence](../../development/f01-audit-evidence.json).

## BUG-20261113-001: Native review overrides configured defaults with the first catalog entries

- Priority: P1.
- Scope: `packages/apexo/src/cli/native-code-review.ts`, local and attached native review selection.
- Observed: with `model: "reviewfixture/z-preferred"` and `default_agent: "reviewer"`, an invocation without explicit selection completed using `reviewfixture/a-first` and `build`. The admitted input and actual provider request both selected `a-first`. Explicit `--model reviewfixture/z-preferred --agent reviewer` selected the configured values correctly.
- Expected: omitted CLI options preserve configured native model and agent defaults.
- Reproduction:
  1. Use an isolated repository and local OpenAI-compatible provider with two enabled models, `a-first` and `z-preferred`, in that order.
  2. Set the top-level model to `reviewfixture/z-preferred`, configure a primary `reviewer` agent, and set `default_agent` to `reviewer`. Remove unrelated provider credentials from the fixture environment.
  3. From `packages/apexo`, run `bun src/index.ts review --dir <fixture-repository> --session-protocol native --format json --ephemeral`.
  4. Inspect `input.model`, `input.agent`, `result.model` and the provider request's `model`. Repeat with the explicit selection above as a control.
- Root cause: the CLI chooses the first visible non-subagent and then the first enabled catalog model. The catalog lists are not configured-default selectors. It sends those inferred values as explicit Session and review overrides.
- Fix: not applied during this audit. Use existing native default resolution for omitted options, preserving explicit overrides; no separate review model-selection framework is needed.
- Verification: the local-only three-invocation probe produced provider models `a-first`, `z-preferred`, `z-preferred`. The first two invocations establish the default-selection defect and explicit-selection control. An earlier diagnostic also selected the built-in XAI model with a synthetic fixture key; that accidental external request is not used as the primary proof. No user credentials were used.

## BUG-20261113-004: A nonexistent explicit review agent is accepted

- Priority: P2.
- Scope: native review CLI and `SessionCodeReview.start` / child agent selection.
- Observed: `--agent missing-review-agent --model reviewfixture/z-preferred` exited 0 with a completed report. The admitted input retained the nonexistent agent, and provider execution still occurred.
- Expected: an unsupported explicit agent fails before review admission/provider work, as required by the F01 CLI compatibility contract.
- Reproduction: use the local fixture above, confirm that `missing-review-agent` is absent from its agent catalog, then run `bun src/index.ts review --dir <fixture-repository> --session-protocol native --format json --ephemeral --model reviewfixture/z-preferred --agent missing-review-agent`.
- Root cause: the CLI validates model references but not the requested agent. Core admission also validates only explicit models/fallbacks. `AgentV2.select` preserves an unknown ID with undefined agent information, which the worker accepts.
- Fix: not applied during this audit. Validate the explicit agent against existing native selection rules before persisting an admission, and return a clear invalid-selection error.
- Verification: the same local-only probe returned `status: completed`, `input.agent: missing-review-agent`, exit 0 and an additional real local provider request. This is distinct from the configured-default defect above.

## Remediation on 2026-11-13

- BUG-20261113-001: the CLI no longer converts catalog order into explicit overrides. Omitted selections stay omitted, so the existing native Agent and Catalog defaults resolve them. The review child respects its selected agent's model when no parent/model override exists. An optional `variant` input preserves variant-only CLI selection while leaving model choice native; explicit model variants retain their existing nested form. Generated clients were regenerated.
- BUG-20261113-004: the CLI checks an explicit agent against its native catalog before creating a temporary parent. Core independently resolves an explicit agent before writing the review row. Unknown agents return `Agent unavailable`; no provider call is made.
- Verification: `test/cli/code-review.test.ts` passes two tests / 37 assertions with a non-first configured model and a configured reviewer system marker. Actual local and attached requests select `z-preferred` and include that reviewer marker; explicit model/build overrides still work. A variant-only invocation selects the configured model, records the variant and transmits its fixture extension field. Native tests also prove invalid-agent rejection leaves zero review rows and zero calls. The final combined-suite and gate results are recorded in the implementation checkpoint.
