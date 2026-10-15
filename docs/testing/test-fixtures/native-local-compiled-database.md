# BUG-20261015-193: Compiled terminal inspection opened another channel's database

- **Status:** Corrected and verified; no lost Session or product persistence defect established.
- **Scope:** The first standalone-binary native-local terminal acceptance run.
- **Observed:** The real mini terminal completed Question approval and a second prompt, then exited with the expected SIGTERM status. The source-based passive inspector found zero Sessions.
- **Expected:** Inspect the exact database used by the compiled terminal, then verify its durable history and passive reopen.
- **Root cause:** The compiled executable used its embedded branch channel, while the source inspector used the `local` channel. Both correctly created different default database filenames under the same isolated data directory. Sharing only HOME/XDG paths does not select the same channel database.
- **Fix:** Supply one explicit fixture-owned absolute `APEXO_DB` path to both the terminal and its source inspector before either host starts. Preserve channel-dependent production defaults and all history assertions.
- **Reproduction:** Build the local standalone executable, set `APEXO_TEST_CLI_BIN` to it, then run `bun script/grok-native-local-terminal.mjs` from `packages/apexo`.
- **Verification:** Original failure and both databases were retained. Both retained databases were read directly: the compiled channel had one Session and the source channel had zero. Corrected standalone mini/fullscreen Question, permission with same-Session reopen, Plan and Stop checks all passed, along with default compatibility and rejected options. This is one fixture-authoring episode.
