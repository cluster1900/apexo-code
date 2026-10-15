# Native Memory Pending-Permission Route

- **Bug ID:** BUG-20261014-139
- **Type:** Test fixture
- **Scope:** Native Memory production acceptance
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

Automatic Memory correctly withheld the index for deny/ask agents, but the
fixture then requested nonexistent `GET /api/permission` and received HTTP 404.
It should inspect pending requests through the declared native contract.

## Cause and fix

The fixture guessed a legacy-shaped collection path. The Protocol exposes
`/api/permission/request` and `/api/session/:sessionID/permission`. Inspect each
denied/undecided Session through the latter, which also verifies Session isolation.
No product endpoint was added for the mistaken test URL.

## Verification

CLI and rebuilt Desktop each passed seven scenarios and twelve provider requests. Both deny and ask Sessions had no pending permission requests.
