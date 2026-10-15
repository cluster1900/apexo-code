# BUG-20261014-211: MCP retirement did not wait for forced child close

- **Scope:** New native MCP stdio process-group retirement.
- **Discovery:** Source review identified that close returned immediately after SIGKILL without awaiting the direct child's close event. A preceding process-existence test passing did not establish that every forced shutdown was reaped before gate release.
- **Expected:** Retirement waits for bounded child closure before releasing the Location reload gate. Cleanup failures remain visible.
- **Reproduction:** Start a real child that ignores SIGTERM and remains alive after stdin closes; await transport close and verify its PID no longer exists.
- **Root cause:** The shutdown path awaited graceful termination but omitted settlement after the final forced signal.
- **Fix:** Await the child's close promise with a two-second bound after forced shutdown. Non-ESRCH process-group failures and close timeout reject cleanup; the service finalizer logs cleanup failure and preserves the defect instead of silently ignoring it.
- **Verification:** The forced-close regression passed, as did the actual MCP reload test verifying both parent and descendant termination. The settled MCP suite passed 6 tests and 36 assertions. One source-review occurrence.
