# BUG-20261015-292: Browser operation fixture did not establish Retry readiness

- Scope: Native Memory operation browser acceptance.
- Observed: After a real Dream published its topic, the fixture clicked Retry and timed out waiting for its receipt. The recorder contained no retry POST. Generic action readiness and the presence of the Dream row did not establish that Retry was enabled.
- Expected: Wait for the exact Retry control to become enabled after the receipt's local ownership settles, then perform one click and verify the native request.
- Cause: The fixture used the unrelated prepare control's enabled state. It did not capture the failed click's exact disabled state, so the original click timing remains evidence-limited; no product transport failure is inferred.
- Correction: Observe Retry's actual enabled state, click once, and require a real POST with the original retryOf. No sleeps, repeated clicks, or provider retries were added.
- Verification: The corrected browser run sent the retry POST, produced a finished original-plan retry, and retained one Dream provider call. That run subsequently failed at the separate explicit-flush fixture expectation (BUG-20261015-294); it is not a full UI acceptance pass.
