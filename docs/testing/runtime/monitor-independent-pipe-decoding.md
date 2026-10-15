# BUG-20261015-168: Unconfined Monitor merged independent UTF-8 streams

- Status: reproduced, corrected and integrated; the shared 21-file regression passed 141 tests / 803 assertions. All 21 workspace typechecks and shared CLI/rebuilt Desktop acceptance passed ten checks / 57 calls each, including split-byte output through actual model-facing updates; all twenty command-owned PIDs were absent after cleanup.
- Occurrences: one integration episode.
- Scope: native Monitor through SessionProcessExecution and AppProcess, outside the command sandbox.

## Observed and expected behavior

A real shell wrote the first two bytes of an emoji to stdout, emitted a Chinese stderr line, then wrote the remaining emoji bytes to stdout. The actual live Monitor notification contained `FIRST�ERROR中文\n��`. It should have contained intact `FIRST😀` and `ERROR中文` lines. The initial targeted test failed at the real notification boundary (zero passes, one failure, five assertions).

## Root cause

The pure Monitor reducer owns independent channel decoders, but the process integration selected `combineOutput: !confined`. Unconfined Monitor therefore observed AppProcess's merged `handle.all` stream tagged `combined`. Bytes from independent pipes could be interleaved inside a multibyte sequence before either decoder saw them. Selecting separate output also requires an explicit stderr bound: the previous `maxErrorBytes` option was supplied only for confined execution.

## Correction

Monitor always selects separate stdout/stderr observers and bounds each AppProcess collector to one MiB. Ordinary unconfined Shell keeps combined behavior. Both observers remain single-reader, scoped and backpressured. The retained preview continues to use its own bounded per-channel decoders; its cross-pipe text order does not imply a total write order.

AppProcess's separate result has `stdout`, `stderr` and `exitCode`, without combined `output`. The owner already derives public output from its observer capture and uses only `exitCode`; confined settlement validates its original stdout handshake. No consumer was changed to assume a nonexistent combined result.

## Verification

From `packages/apexo`, pinned Bun 1.3.14:

`bun test test/v2/monitor-execution.test.ts --test-name-pattern 'real unconfined Monitor'`

The corrected actual owner/notification test passed one test / 33 assertions, including intact split UTF-8 lines, no replacement character, Stop/rearm, retained-output capacity, cancellation and deletion cleanup. The CLI/Desktop acceptance idle scenario now writes the same split emoji around stderr and checks the actual model-facing update. The complete eight-file Monitor/Shell/Plan/store/foreground-Bash gate passed 31 tests / 378 assertions. Core and Apexo typechecks passed on the corrected private source. Corrected native CLI and rebuilt private packaged Desktop each passed ten lifecycle checks / 57 provider calls; both included split-byte stdout around stderr through actual model-facing updates. All ten recorded process PIDs in each run were absent after cleanup. These are private scoped results, not shared integration or complete CI gates. No repeated historical occurrence or whole-repository gate is claimed.

The first CLI verification attempt timed out at backend readiness before any scenario/provider call; the owned child was reaped and the captured log contained only the unsecured-server warning. Its cause is unresolved and a later successful start is not a fix. A subsequent attempt reached the provider but the fixture incorrectly required both pipes in every 200 ms batch. The observed stderr-only batch was valid. The idle scenario now accumulates actual live updates until both complete strings arrive before allowing termination, without requiring a particular cross-pipe batch count. These verification observations are not additional runtime-corruption occurrences.
