# BUG-20261015-088: Sandbox UI fixture assumed the simplified command term in Traditional Chinese

- Scope: sandbox and Plugins App acceptance fixtures; two independent locale-expectation episodes. No recurring constraint is warranted yet.
- Observed: the first run passed English and Simplified Chinese status checks, then expected `原生命令` in Traditional Chinese. The actual reviewed UI correctly displayed `原生指令`, visible in the captured screenshot. A subsequent setup attempt supplied text without a selector to agent-browser's `type` command, so no prompt was entered.
- Expected: assertions match each reviewed locale and input is entered through the actual composer using the tool's documented selector/value arguments.
- Root cause: the fixture reused a Simplified Chinese substring for both Chinese locales and initially used an invalid automation argument shape. These are separate setup mistakes within the same new fixture authoring episode, not independent recurrent product defects.
- Fix: assert `原生指令` for zht and use `fill` with the actual contenteditable composer selector. Product translations were not changed to satisfy the fixture.
- Verification: from `packages/apexo`, `bun script/grok-native-sandbox-ui.mjs browser --locales` passes seven checks across en/zh/zht, including all three stored profiles and ordinary model roundtrips. No weakened creation or provider assertions.

## Independent Plugins locale assertion (2026-10-15)

The composed native Plugins English run passed all eight checks. The Simplified Chinese run then timed out waiting for the deferred-cleanup notice, although its captured native-window screenshot correctly displayed the translated notice. The final assertion still searched for an English literal; earlier assertions already used the selected locale dictionary. This is the same fixture mistake of reusing another locale's text, independently introduced in a different acceptance script.

The final assertion now uses `plugins.cleanupDeferred` from the selected real dictionary. No product text, data lifecycle, deadline or backend assertion changes. Reproduce from `packages/apexo` with `bun script/grok-plugin-data-ui.mjs native --locale zh`; the corrected zh and zht invocations each pass all eight native-window checks with zero provider requests. The failed run and its actual translated screen remain evidence; no product defect is inferred from that timeout.
