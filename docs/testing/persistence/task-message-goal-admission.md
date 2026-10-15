# BUG-20261015-311: Active Task message admission omitted Goal eligibility

- Scope: Native launch-bound Task delivery and promotion.
- Observed: A live launch with an open delivery gate accepted a new durable correction after its captured Goal attempt was paused. The before-fix real-store regression expected Failure and received Success.
- Expected: The exact receiver and sender Goal attempts must remain current and active when admission or promotion commits, independently of asynchronous launch closure.
- Reproduction: Create a real Goal attempt and owned active Task launch, open delivery, pause the Goal without closing the launch, then send a fresh message ID. Exhausting the budget through actual Goal usage exercises the equivalent terminal boundary.
- Root cause: Launch owner, Created proof and gate checks did not include the captured Goal attempt.
- Fix: The shared active-launch check now calls canonical SessionGoal.check for receiver and sender role attempts. The check runs within admission and promotion transactions; it also applies to passive-wait revalidation. Existing receipt retries remain evidence reads and actual provider usage remains canonical.
- Verification: The before-fix regression failed with late admission. After the fix, the real-store and HTTP delivery suite passed six tests / 97 assertions. Store tests retain a running launch while pause or budget exhaustion rejects a fresh input, and retain promoted correction accounting. The HTTP test pauses a real foreground Goal child while message permission is held, approves afterward, and verifies conflict with no receipt.
- Independent occurrences: One product defect confirmed. No recurring rule is promoted.
