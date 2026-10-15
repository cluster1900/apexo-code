# BUG-20261014-024: Native Preview Fixture Asserted Viewport Visibility Before Scroll Paint

- **Status**: Fixed & Verified; **Verified Occurrences**: 2; **Linked Rule**: None (below threshold).
- **Scope**: Asynchronous preview visibility check in Goal native and browser preview test fixtures.
- **Observed**: Checking viewport visibility immediately after the preview body text appeared in the DOM returned `false`, whereas the failure screenshot taken moments later showed both the preview title and body scrolled into view without any extra scroll command.
- **Expected**: Poll for bounded viewport visibility and hit-target readiness rather than treating initial DOM insertion as proof that the `requestAnimationFrame` scroll has completed.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-native.mjs`.
- **Root Cause**: The component scrolls the preview into view inside `requestAnimationFrame`, while the test performed a single immediate viewport check right after DOM text insertion.
- **Fix**: Poll the viewport and `elementFromPoint` hit check with a bounded timeout in both native and browser fixtures without adding synthetic test scrolling or weakening visibility assertions.
- **Verification**: Verified in browser and native preview test runs.

On 2026-10-14, a subsequent **full** run passed all seven checks with the same visibility predicate and no product-code change. Four geometry observations showed the heading move from y=762.3 (hit the dialog overlay, scrollTop=88) to y=643.8 (hit the heading, scrollTop=206.5). This directly establishes that DOM readiness can precede scrolling in a full run and justifies bounded readiness polling. It does not explain the earlier 62-observation failure. Keep that persistent-failure case and the separate verifier-expansion disappearance under investigation; do not mark the whole issue fixed on the basis of this pass.

## Second independent occurrence: Plan review keyboard fixture

The new native Plan review browser fixture read scrollTop immediately after End and asserted option focus immediately after keyboard navigation. The scroll read was 0 and the option still showed Approve. Diagnostic observations established that the existing native browser scroll and component requestAnimationFrame subsequently reached the requested state without extra product behavior: PageDown moved to 199, End reached 1746 in a 1974px document with 228px viewport, focus stayed in the text region, and defaultPrevented was false. The original immediate checks were not evidence that keyboard scrolling was broken.

The fixture now waits for the actual bounded scroll-bottom and focused-label predicates before asserting the same geometry and identity. No synthetic scrolling or product keyboard handler was added. `bun run script/grok-native-plan-ui.mjs browser` passed 6 checks/6 provider calls in en/zh/zht, including exact text, wrapped long tokens, reachable end marker and both explicit-false and default-custom navigation. The two immediate-read failures belong to this one authoring episode, not two recurrences. This verified second occurrence does not resolve the separate historical persistent-failure observations above and remains below promotion threshold.
