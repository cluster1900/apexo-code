# Installed macOS OAuth browser launcher assumption

- **ID:** BUG-20261015-040
- **Scope:** Off-tree installed-reference OAuth probe on macOS; one authoring occurrence, not an Apexo OAuth defect.
- **Observed:** Configured-client authentication succeeded with no dynamic registration, but the added fixture assertion failed because its expected browser-shim marker file did not exist.
- **Expected:** Verification identifies the browser path actually used by the installed build rather than assuming environment-based interception.
- **Reproduction:** Set BROWSER and prepend a fixture `open` executable to PATH, then assume the installed macOS launcher executes one of those shims.
- **Root cause:** This installed launcher did not use the proposed environment/PATH shim. It opened the localhost consent URL through the system browser instead. The fixture's assertion concerned an unsupported interception assumption, not authorization success.
- **Fix:** Remove the shim requirement and record the consent request's browser user-agent. Use only the isolated localhost authorization server and private runtime home; no real account, credentials or external consent are involved.
- **Verification:** The corrected configured-client probe passed five checks with zero provider requests. Its authorization request identified Chrome; the reference callback page closes its own tab. Subsequent read-only native browser inspection showed the ordinary tabs and no fixture callback tab in the visible window. An unrelated remote-debugging permission sheet was left unchanged. All three agent PIDs were absent after awaited cleanup, and both fixture HTTP servers were closed. This does not claim that all installed launchers behave identically.
