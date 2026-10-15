# BUG-20261015-268: Text conversion fixture guessed error class tags

- Status: corrected; shared runtime assertions and refreshed Core/Apexo types pass.
- Scope: native text-attachment converter and side-question runtime fixtures.

The first converter run passed three tests and failed nine assertions because the fixture expected `LLMError` as the error tag. The exported constructor actually uses `LLM.Error`; its `InvalidRequestReason` is a Schema class, not a tagged error. The converter had returned the intended typed failure. A subsequent package typecheck also rejected reading `.code` from the complete side-question failure union without narrowing it.

The fixture now checks the actual exported `LLMError`, `InvalidRequestReason` and `SessionSideQuestion.Error` constructors before inspecting their fields. It does not change production errors or cast away the service's error channel. These assertions and the compiler correction belong to one authoring episode, not separate recurring failures.

Verification: the corrected converter plus native runtime tests passed 13 tests / 79 assertions before the additional explicit side-question constructor assertion. The final Apexo package typecheck passed after constructor narrowing. The subsequent combined run passed all new converter/runtime cases; an independent pre-existing HTTP timeout is recorded as BUG-20261015-273. No product error-classification change is claimed here; BUG-20261015-222 is a different runtime issue.

After integration, the shared four-file converter/runtime/headless/side-question command documented in [the CLI verification checkpoint](../../native-headless-cli.md#shared-integration-checkpoint) passed 22 tests / 178 assertions. Refreshed Core and Apexo package typechecks also pass after the text amendment.
