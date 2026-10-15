# Native Memory mini readiness predicate

- **Bug ID:** BUG-20261015-172.
- **Scope:** Native Memory acceptance through actual mini CLI attach.
- **Observed:** The first mini run timed out waiting for an “Ask anything” placeholder or replayed content. Its captured active frame showed the ordinary empty BUILD/model/command footer; the fixture used `--no-replay`.
- **Expected:** Establish the actual terminal presentation and completed passive native bootstrap before sending input.
- **Root cause:** One fixture-authoring episode assumed a placeholder or restored transcript that this attachment mode does not render. This is not evidence of a failed native attach or a permission/cancellation defect.
- **Fix:** Wait for the mini command footer and actual successful Session question-bootstrap request. Fullscreen retains its own readiness predicate.
- **Verification:** The corrected actual mini run passed six checks with five setup provider calls and zero additional management calls. All owned processes were reaped. Original active-frame evidence is retained with the acceptance artifacts.

## Fullscreen menu readiness in the same authoring episode

A later fullscreen run waited for generic `memory` text, which was already present in the historical remember-tool transcript. Its captured frame showed the autocomplete menu still open. The fixture now waits for the actual `/memory` menu row before selecting it and follows the ordinary fullscreen selection/submission gesture. This selector cause is distinct from the mini placeholder assumption above; neither is counted as a historical recurrence. The next assertion also matched an original note in the transcript behind the dialog, then sent the second toggle while the first was pending. The recorded requests contained only the enable PATCH, and the captured dialog showed the correctly enabled preview. This was not a product toggle defect. All Memory mode/preview/confirmation assertions now use the visible dialog region, and each toggle waits for its successful PATCH and corresponding mode before proceeding. The transcript is preserved. The corrected fullscreen run passed six checks with five setup provider calls and zero additional provider calls; the final explicit PATCH-barrier matrix is recorded in the feature acceptance report.

The final assertion audit initially used invented guidance fragments that did not match the existing mini capability paragraph. The captured frame showed the actual passive browser and no-matching-notes state after the command; the fixture now checks the exact existing mini paragraph or the actual fullscreen toast phrase. This correction belongs to the same fixture-authoring episode and changes no product copy.

The final fullscreen toast check also needed to account for a border and line wrap separating the complete sentence. It now checks the exact visible guidance prefix within the active toast instead of an invented phrase or a full unbroken sentence. Final actual mini/fullscreen runs passed six checks each at 120×40 and 80×24 (twenty-four total), with five setup provider calls per run and no management provider calls. No product copy or permission behavior was changed for these fixture corrections.
