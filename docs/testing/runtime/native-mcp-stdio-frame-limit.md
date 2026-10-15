# BUG-20261014-210: MCP stdio framing lost trailing partial-frame bytes

- **Scope:** New native MCP stdio transport.
- **Discovery:** Source review identified that resetting a chunk byte counter after any parsed message discarded bytes belonging to an unfinished trailing frame in that same chunk. No production incident or historical recurrence is claimed.
- **Expected:** Each wire frame remains bounded across arbitrary chunk boundaries, including complete and partial frames sharing a chunk.
- **Reproduction:** The focused framing test supplies one complete JSON-RPC frame followed by a 60-byte partial frame with a 64-byte limit, then four bytes, then one byte. The final append must fail.
- **Root cause:** Parsed-message completion reset a counter measuring incoming chunks rather than the individual newline-delimited frames.
- **Fix:** Track byte lengths through every newline segment before adding a chunk to the SDK ReadBuffer. Preserve the remaining partial-frame length and reset only at its terminating newline.
- **Verification:** The focused regression passed in the native MCP suite; the settled MCP suite passed 6 tests and 36 assertions. One source-review occurrence.
