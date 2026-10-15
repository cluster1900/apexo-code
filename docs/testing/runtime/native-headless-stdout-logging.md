# BUG-20261015-246: Embedded native logs contaminated headless stdout

- Status: verified in the final private local CLI matrix and package typecheck.
- Scope: the local embedded host used by native headless execution.

The first captured CLI stdout began with Effect project-copy and Location initialization log lines. Such diagnostics invalidate the existing machine-readable stdout contract. The headless local host now supplies a scoped stderr logger to its route graph. The ordinary interactive host retains its existing behavior; no global console replacement or process-wide logger mutation is used.

Actual local JSON and streaming JSON commands subsequently produced exclusively parseable line-delimited JSON, each containing one terminal input_execution record and exactly one provider request. The plain command also completed. Final local acceptance passed fifteen checks / twenty requests, both attach matrices passed seventeen checks / twenty-one requests, and the Apexo package typecheck exited 0. The headless logger change remains scoped to embedded local execution.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
