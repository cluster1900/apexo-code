# BUG-20261014-170: Native bundle skills with no description failed preparation

- **Scope:** Native installed bundle skill activation and reload.
- **Observed:** A valid skill whose frontmatter omitted `description` caused staged reload to fail with `Expected string, got undefined` at the embedded skill description. The previous generation remained active.
- **Expected:** Description is optional; a skill with a name and content must activate successfully.
- **Reproduction:** Install a trusted local bundle with a skill, remove its description, then call native Plugins reload. The runtime integration fixture exercises this transition.
- **Root cause:** The adapter spread the bundle reader's explicit `description: undefined` property into the encoded embedded-source constructor. The schema distinguishes an absent encoded optional key from a present undefined value.
- **Fix:** Omit the optional description key when absent before constructing the embedded source.
- **Verification:** From `packages/apexo`, `GITHUB_ACTIONS=false bun test test/v2/plugin-runtime-guard.test.ts test/v2/plugin-bundle-runtime.test.ts` passed 7 tests with 36 assertions. The fixture verifies description-less skill content after reload, preserved state on failed reload, and captured hook generations. The final combined compatibility/runtime/guard run passed 10 tests with 47 assertions; Core and Apexo package typechecks exited 0. The prior failing fixture reached six assertions before the reload failure.

The initial integration occurrence is described above; the independent second occurrence is recorded below. No recurring rule is claimed.

## Second occurrence: native project catalog adapter

The first native project HTTP test run passed the fully populated metadata test but returned typed 503 responses for both ordinary and Git Session-created project rows. These rows contain SQL nulls in optional columns. The new adapter converted those nulls to present `undefined` keys before decoding `Project.Info`, repeating the same absent-versus-undefined schema-boundary mistake.

The mapper now omits absent root fields and nested icon/time fields. Invalid non-null values still fail validation instead of becoming an empty catalog. From `packages/apexo`, `bun test test/project/native-catalog.test.ts test/e2e/v2-project.e2e.test.ts` passed three tests and 28 assertions, covering real empty storage, persisted metadata, malformed stored data, and actual native HTTP current/list responses for plain and Git Locations. Both HTTP tests verify zero model calls. This is the second independent adapter occurrence; no recurring rule is warranted. The missing endpoint that exposed the mapper is separately recorded as [BUG-20261014-274](../ui/native-project-bootstrap-api.md).

## Third occurrence: Feedback text-only update adapter

The initial image-preserving text-tool adapter called the operator Save decoder with an explicit `images: undefined`. The encoded `Schema.optionalKey` contract permits omission, not a present undefined value. A real store test failed the text-only update with `Invalid feedback draft fields`; its existing image snapshot remained unchanged. Passing the decoded text input without constructing an absent `images` key fixes the adapter and retains existing attachments. The focused store suite passed 11 tests / 70 assertions, followed by store/native/compat HTTP verification at 17 / 125. Real CLI native and compatibility and rebuilt Desktop native runs also completed text-tool updates while preserving the original image bytes.

These are three independently observed absent-versus-undefined adapter episodes, so [RULE-20261015-021](../../rules/encoded-optional-key-omission.md) now applies. The rule does not change decoded optional fields or require removing intentionally defined values.
