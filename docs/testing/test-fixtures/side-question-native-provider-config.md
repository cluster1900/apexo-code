# BUG-20261014-082: Native side-question fixture config syntax

- Scope: new native V2 HTTP/provider fixture; one failed test invocation.
- Observed: Bun rejected an unmatched object delimiter before running the test.
- Expected: the fixture config parses and exercises native HTTP sampling.
- Reproduction: run `bun test test/e2e/v2-side-question.e2e.test.ts` in `packages/apexo` on the initial fixture.
- Root cause: one missing closing brace in the nested provider/model configuration.
- Fix: close the provider mapping and format the fixture before rerunning.
- Verification: the focused native V2 HTTP/provider rerun passes 1 test and 13 assertions. No production defect was implicated.

## Independent LSP fixture occurrence

The new native LSP UI fixture also omitted one closing brace in its nested provider/model configuration. Bun rejected it before creating any runtime process. The mapping was closed and the file formatted before testing. Production browser and actual native-window runs then each passed six checks, covering English, Simplified Chinese, Traditional Chinese, passive status, live process-loss invalidation, and native-only routing. This is the second independent occurrence of the nested-config delimiter mistake. The later consolidation below establishes the current count.

## Independent Task and Memory occurrences

The Task provider fixture separately omitted a closing brace and failed before application assertions with `Expected "}" but found ")"`. Its formatter invocation skipped the external draft file, so exit status alone did not validate syntax. Closing the mapping and formatting the actual file with repository configuration allowed real provider execution. The initial foreground/follow-up/output checkpoint passed 16 assertions; the combined three-file checkpoint passed 44. The original evidence and later, unrelated Task fixture observations remain in [BUG-20261015-060](native-task-e2e-object-formatting.md).

The newly authored Memory CLI fixture independently omitted a closing brace in its nested `providers` object. `bun script/grok-memory-native.mjs cli` failed at parse time with the same delimiter diagnostic, before a server or provider started. The mapping was closed, the actual file formatted, and `node --check script/grok-memory-native.mjs` completed before executing it. The corrected CLI acceptance passed four checks / three provider calls. No product behavior or assertions were relaxed.

## Consolidated count and old-ID mapping

Five independent authoring episodes share this exact missing closing-brace root cause: side-question, LSP, Task, Memory, and Scheduler. Repeated runs and cascading parser diagnostics do not add occurrences. Follow [RULE-20261015-013](../../rules/fixture-provider-config-syntax.md).

| Original ID / observation | Canonical root-cause record | Preserved scope |
| --- | --- | --- |
| BUG-20261014-082: side-question and LSP delimiters | BUG-20261014-082 | Two original episodes remain above. |
| BUG-20261015-060: Task provider delimiter only | BUG-20261014-082 | The original record remains a backlink and retains its unrelated status, deadline, helper-argument, and error-envelope observations. |
| Memory CLI provider delimiter | BUG-20261014-082 | One new episode; no duplicate bug ID. |

This is a partial observation mapping, not retirement of all BUG-20261015-060 findings.

## Additional syntax-gate observation (not a recurrence)

While extending the native-local terminal fixture with a compatibility branch, a scripted edit placed a closing wrapper brace inside an embedded child-script template instead of around the outer inspection block. The formatter and `node --check` both rejected the actual file at the outer `finally` before any runtime startup. Moving the brace to its intended outer block made both checks pass. This is not another missing nested provider-config brace, so it does not add another exact-root recurrence. It is retained here as additional evidence for applying RULE013's actual-file syntax gate, not as a product failure or a fifth occurrence.

## Independent Scheduler fixture occurrence

The new native Scheduler execution fixture omitted a closing brace in the nested provider mapping. Formatting the actual fixture rejected the source before runtime startup. The mapping was closed, an associated extra delimiter was removed in the same authoring episode, and formatting plus the private Apexo package typecheck passed. The corrected actual lifecycle/store gate later passed five tests / 77 assertions. The separate Created observer decoder and Stop receipt failures are BUG079 and BUG188, not additional delimiter occurrences.

## Independent MCP attachment fixture occurrence

The attachment picker fixture initially omitted one closing brace in its nested provider map. The formatter rejected the actual file, and an incorrectly sequenced acceptance invocation also stopped at parsing before runtime startup. The mapping was rewritten clearly, the actual file formatted, and `node --check script/grok-mcp-attachment-fixture.mjs` completed before subsequent runs. Actual mini and fullscreen entrypoint checks then each passed four scenarios. This is the sixth independent delimiter-authoring episode; it does not count the later dialect-selection mistake as another delimiter occurrence. RULE-20261015-013 remains applicable.

## Independent child-placement fixture occurrence

The new placement revocation fixture omitted one closing brace in its provider/model map. The initial Bun invocation stopped before any test body (0 passed, 1 failed, 1 parse error); it did not prove a placement defect. The mapping was closed and the actual file formatted before its runtime controls. This is the seventh independent nested-provider delimiter authoring episode. RULE-20261015-013 still applies; the test must not be started before its actual syntax gate succeeds.
