# BUG-20261014-065: Host-hook comparison fixtures assumed the wrong transport framing and route

- Scope: New CLI/Desktop/official host-hook comparison scripts.
- Observed behavior: The first CLI inspection requested `/experimental/hooks` and received 404. The official runtime successfully denied the read, but its pretty-printed stdin JSON broke a line-by-line JSON log parser.
- Expected behavior: Use the actual `/hooks` API route and parse each command's complete JSON stdin before appending one log record.
- Reproduction: Run the initial hooks comparison fixtures against the shared API and installed Grok ACP runtime.
- Root cause: The fixture inferred a path prefix from the API group name and assumed compact single-line stdin JSON; neither is part of the official contract.
- Fix: Request `/hooks`. The official command fixture decodes stdin JSON and serializes it as one JSON line before logging. No product assertion was removed.
- Verification: Corrected CLI fixture passed all initial four scenarios and sanitized inspection. Corrected installed-official fixture passed all three initial scenarios. Later rewrite/ask scenarios are tracked in the hooks parity document.
- Occurrences: One failure per independent fixture assumption. No recurring constraint is promoted.

An additional typed fixture correction removed v2 event IDs from legacy plugin-event objects. Package typecheck then passed; the observer suite passed seven tests and 20 assertions. This was a fixture shape mismatch, not a runtime regression.
