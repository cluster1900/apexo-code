# BUG-20261015-247: Headless acceptance selected an unconfigured fixture model

- Status: verified fixture correction; no product model-resolution defect.
- Scope: native headless CLI acceptance script.

The first script explicitly selected fixture/test, although the reused real local provider helper configures xai/grok-4.7. The native runner correctly reported ModelUnavailable and made no model request. Select the helper's actual configured provider/model instead of inventing an unrelated identifier.

The corrected local plain, JSON and streaming JSON scenarios each exited successfully and made exactly one provider request. This is separate from the independently observed global SSE notification and stdout logging adapter defects. No fallback or model-resolution behavior changed.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
