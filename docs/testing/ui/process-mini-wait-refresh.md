# Mini Process polling cancelled an unchanged selection's wait

- **Bug ID:** BUG-20261015-195.
- **Scope:** Private native Shell/Monitor manager UI, mini terminal.
- **Observed:** The ten-second passive process wait displayed its pending state, then disappeared during normal list polling. Real HTTP evidence recorded the wait as cancelled with status 499. The same process remained selected and running.
- **Expected:** Updating a list row with the same source-qualified identity preserves its active wait; selecting another source/ID or closing the panel cancels observation.
- **Root cause:** The detail effect read both the stable selected key and the selected object. Each list replacement retriggered its cleanup, aborted the observation signal and cleared wait state.
- **Fix:** Track only the source-qualified selected key and capture the corresponding target without creating an object-identity dependency. Existing selection/disposal cleanup remains.
- **Verification:** An actual footer-renderer regression failed before the fix because the held wait signal was aborted by a same-key replacement. After the fix it passed one test / five assertions, including preserved pending state, returned timeout text, and cancellation on a real key change. Its initial completion assertion needed a microtask/render flush after resolving the controlled Promise; this was fixture scheduling, not another product failure. The real 120×40 mini PTY then passed six checks with 21 setup-provider calls and zero UI-provider calls. Both passive waits returned HTTP 200: one timed out without stopping the Monitor and one settled after joined cancellation. No wait returned 499.

Final verification also passed the focused footer pair (2 tests / 10 assertions) and all three affected package typechecks. The native mini/fullscreen narrow and mixed-host matrices passed with no UI-provider work.
