# Profile Interactive Tool Availability

## BUG-20261014-048 — Exact cross-client comparison ignored intentional noninteractive permissions

- **Status:** Fixed and verified.
- **Verified recurrence count:** 1.
- **Affected scope:** Native Desktop profile acceptance comparison with noninteractive CLI `run`.
- **Observed behavior:** Native profile selection and relaunch succeeded, and CLI completed after the stdin fix. Exact CLI/native tool-array comparison differed only by `ask_user_question`, `enter_plan_mode`, and `exit_plan_mode`.
- **Expected behavior:** The same profile exposes the same permitted contracts; deliberate interaction-specific denials remain enforced.
- **Reproduction:** Compare a normal native Desktop session with `apexo run --profile grok-build --format streaming-json` without adjusting for noninteractive permissions.
- **Root cause:** `run.ts` explicitly denies `question`, `plan_enter`, and `plan_exit` for noninteractive sessions. The native session has no such denials. This is intentional client behavior, not a profile switch failure.
- **Fix:** Assert that these three known interactive tools are exactly the native-only difference; compare all remaining tools exactly. Separately compare the CLI's complete advertised manifest with its actual provider request without exclusions.
- **Verification:** The observed difference was exactly the three source-defined denials. The stdin EOF correction allowed the CLI to finish within the unchanged deadline, also verifying BUG-20261014-042. Full corrected native/CLI acceptance passed: exactly the three interaction-specific differences, all remaining tools equal, and complete CLI manifest/provider equality.
