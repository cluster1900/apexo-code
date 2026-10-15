# Workflow Variant Fixture Overlaid a Protocol-Owned Field

- **Bug ID:** BUG-20261015-028
- **Scope:** Off-tree Workflow model variant acceptance fixture; no product defect.
- **Status:** Corrected and verified in the isolated CLI fixture.
- **Independent occurrences:** 1.

## Observed and expected behavior

The fixture's declarative Workflow stage selected a configured model variant whose body contained `temperature`. The child failed with `http.body cannot overlay protocol-owned field(s): temperature`. Mixed parallel model selection had already completed successfully. The fixture expected an observable valid native variant.

## Reproduction and root cause

Configure a model variant with `body: { temperature: 0.2 }` and select it through the stage's canonical model reference. The native request boundary correctly rejects raw body overrides of protocol-owned fields. The fixture confused arbitrary extension fields with normalized protocol controls.

## Fix and verification

The fixture now uses a permitted custom body field, `workflow_variant: "precise"`, to verify native variant selection reaches the provider. This does not bypass the protocol guard or claim to implement reasoning-effort controls. The assertion still verifies the exact selected variant value at the real provider boundary.

From the isolated `packages/apexo`, `bun script/grok-workflow-model.mjs cli` passed five checks with five provider turns, including the selected variant and unavailable-variant failure before child/provider work. Core and Apexo typechecks passed. The later integrated Desktop result is recorded below.

## Integrated verification

After applying the reviewed source and fixture, the live focused plus native HTTP/lifecycle suite passed 16 tests with 100 assertions. `bun script/grok-workflow-model.mjs cli` passed five checks with five provider turns after the coordinated SDK writer completed. The initial generator/read overlap is separately recorded as BUG-20261014-242. `bun script/grok-workflow-model.mjs desktop` then passed the same five checks with five provider turns against the coordinated packaged backend; the process was reaped.
