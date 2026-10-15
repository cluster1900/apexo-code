# BUG-20261014-079: Interpreter Smoke Test Closed Its Control Channel

- Status: Corrected and verified.
- Type: Test fixture.
- Scope: Staged first-party Rhai interpreter smoke test.
- Independent occurrences: 1. No production failure or recurring constraint is claimed.

## Observed and expected behavior

A shell here-document sent a start request and immediately closed standard input. The interpreter returned `Script terminated` rather than the expected result `42`. The smoke test must keep the host control channel open until the terminal response.

## Reproduction and root cause

Start the staged interpreter with a here-document containing `{"version":1,"script":"40 + 2","args":null}`. End-of-input is an explicit cancellation signal in this protocol. The fixture accidentally requested cancellation while testing successful evaluation.

## Correction and verification

Use `Bun.spawn` with piped input, write the start message without ending the pipe, then read the terminal response and process exit. The staged macOS arm64 Desktop resource returned `{"type":"complete","value":42}` and exit code zero. The interpreter's cancellation behavior was preserved.
