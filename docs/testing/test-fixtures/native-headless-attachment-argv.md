# BUG-20261015-256: Attachment fixture repeated a scalar format option

- Status: verified in the corrected private pure-native attach matrix.
- Scope: native headless CLI acceptance authoring.

The attachment case appended a second `--format json` after `--file` to terminate yargs' array-valued file argument. The shared command builder already emitted the format option. Yargs consequently supplied an array instead of a scalar format, and the CLI correctly rejected it as an unsupported native output format before admission. The expected successful attachment invocation instead exited 1.

Build the argument list with file/other extra flags before the single format option. Preserve parser validation; do not coerce repeated scalar values or silently discard a file. The supported PNG provider callback asserts the uploaded image data URI is present, with one provider request and a completed reply. A separate text/plain case retains the truthful provider conversion failure described in BUG-20261015-257.

The original pure-native attach matrix stopped at the attachment case with the correct parser rejection. The corrected pure-native attach matrix passed seventeen checks with twenty-one provider requests, including successful PNG transport and the truthful zero-request text/plain failure. This is one fixture-authoring episode, not a product defect or an inferred recurrence.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
