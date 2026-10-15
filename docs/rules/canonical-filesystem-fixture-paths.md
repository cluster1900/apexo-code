# RULE-20261015-017: Canonical filesystem identity in fixtures

- **Status:** Active after integration.
- **Scope:** Fixture ownership, containment, environment and private-workspace dependency identity assertions on filesystems with path aliases or symlinks.
- **MUST:** Resolve both actual and expected paths to their canonical filesystem identity before comparing identity or containment. Canonicalize external permission targets before constructing exact-path rules when the runtime checks their canonical identity.
- **NEVER:** Compare a canonical target with a temporary-directory alias and classify the spelling difference as a wrong workspace, dependency or permission implementation.
- **Exception:** Preserve the supplied spelling when that spelling itself is the documented wire or environment contract. Check identity separately rather than normalizing away a contract distinction.
- **Verification:** Retain the original failed assertion, inspect both resolved targets, and rerun the actual path-sensitive fixture or full source/dependency audit. A spelling correction must not hide a genuine different target.
- **Source:** [BUG-20261014-106](../testing/test-fixtures/hooks-environment-canonical-path.md), four independent episodes: installed Hook environment, Workflow external-path deny setup, private Task dependency audit and native LSP workspace URI comparison.
