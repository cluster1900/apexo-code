# BUG-20261015-187: Local comparison fixture assumed native contracts for compatibility

- **Status:** Corrected and verified in both default local terminals.
- **Scope:** One authoring episode while extending the native-local PTY fixture to check unchanged default compatibility startup.
- **Observed:** The mini terminal completed Question approval and a second prompt, but the fixture expected three total requests and observed four. After correcting request accounting, the same comparison expected SIGTERM exit143 and observed exit0.
- **Expected:** Verify the existing compatibility contract independently while keeping native-only assertions intact.
- **Causes:** The default compatibility path made one ancillary title request in addition to three actual Session turns. The provider callback had also incorrectly returned a Question tool response to that title request. Separately, the fixture reused the new native SIGTERM exit status for the existing compatibility CLI, whose graceful exit is zero.
- **Fix:** Return a normal title response for ancillary requests, require exactly three tool-enabled Session turns, and report total and ancillary counts separately. Keep the existing compatibility zero exit status and native143 contract. No product source or lifecycle behavior changed for these assertion corrections.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-native-local-terminal.mjs --compatibility`, with and without `--fullscreen`.
- **Recurrence boundary:** These are distinct comparison assumptions in one fixture-authoring episode. They are not counted as new occurrences of a single recurring product or reference-classification defect.

The fullscreen comparison also initially emitted the native `question` name while its actual compatibility profile advertised `ask_user_question`. The durable tool row recorded an unavailable-tool error; the next fixture response produced completion without a user answer, and the pending-question assertion correctly failed. The callback now selects the Question tool from the actual advertised catalog and asserts that it exists. This additional contract assumption belongs to the same comparison-fixture authoring episode and does not establish a production Question defect.

Final verification: mini and fullscreen each passed four checks, with three actual Session turns and one separately reported ancillary title request (four total calls). Both actual terminal processes exited zero and were reaped. The pending Question interaction and second-prompt completion assertions remained intact.
