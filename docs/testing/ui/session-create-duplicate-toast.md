# BUG-20261015-095: Failed Session creation displayed a second misleading toast

- **Status:** Fixed; corrected browser/native-window regression passed. Paired composer measurement also passed without an observed increase.
- **Scope:** Shared App composer submission for new Sessions, including selected command-sandbox creation.
- **Independent occurrences:** One native-window acceptance episode.

When the real native creation endpoint returned the fixture's deliberate HTTP 503, the composer displayed the specific Session-creation error and then a second generic prompt-send failure saying that the Session could not be obtained. The later toast covered the useful first error in the actual Desktop screenshot. The selected profile and prompt remained intact, and no fallback or provider request occurred.

The creation catch reports the error and returns undefined; execution then falls through to the later missing-Session guard, which reports another error. A failed creation must return after its first error, preserving draft/profile state and allowing explicit retry. The later guard remains necessary for other genuinely unavailable Session cases.

The repair returns immediately when creation failed, before seeding/navigating or reaching the later missing-Session guard. The actual browser/native-window fixture inspects both App toast implementations immediately after creation failure and rejects the redundant prompt-send title. Its initial wrong-layout selector is recorded separately as [BUG100](../test-fixtures/sandbox-toast-layout-selector.md).

Verification from `packages/apexo`: the corrected assertion failed against the preserved pre-fix production App at the explicit redundant-prompt assertion; it passed against the repaired production browser and rebuilt actual native Desktop window. Each after run passed seven checks / three provider calls across en/zh/zht, including retained draft/profile, one failed creation request, no silent Off fallback, and a successful explicit retry. Before and after screenshots were inspected. `bun typecheck` and the App/Desktop production builds passed. The fixed-backend production composer comparison measured 112.5 ms median / 118 ms p95 versus 122 / 126 ms before this repair, with no Long Task entries; see [measurement](../performance/command-sandbox-composer.md). This small sample is not a causal speedup claim.
