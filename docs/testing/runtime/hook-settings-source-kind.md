# BUG-20261015-351: Settings-file paths were scanned as Hook directories

- **Scope:** New user configuration layers and Claude/Cursor Hook imports in host discovery.
- **Observed:** The draft loader treated all discovered candidates as either a file or a directory. With imports enabled, directories named `.claude/settings.json`, `.claude/settings.local.json` and `.cursor/hooks.json` caused their child JSON files to become executable Hook definitions. Directories named `requirements.toml` and `managed_config.toml` did the same. The regression fixture expected zero handlers and found five.
- **Expected:** Configuration and vendor settings paths identify individual files. Only the documented native Hook directory/file and explicit registered paths may expand a directory into sorted JSON sources.
- **Reproduction:** Create a private host home with Claude/Cursor imports enabled. Replace each settings-file candidate with a directory containing `unexpected.json` with a valid command Hook. Run `bun test test/plugin/hook-sources.test.ts -t 'settings paths'` from `packages/apexo`. The draft returned five handlers.
- **Root cause:** The discovery loop used one filesystem-shape check for both directory-capable sources and settings-file sources. Candidate construction discarded that semantic distinction.
- **Fix:** Each candidate carries its loader-assigned settings-file kind. A settings candidate must pass `stat.isFile()` before parsing and can never enter directory enumeration. This metadata is not read from untrusted Hook documents. Native/registered Hook paths retain their existing directory behavior.
- **Verification:** The failing-before fixture is preserved. The corrected regression and related source/import suite passed: 31 tests, 140 assertions. Core typechecking and the native CLI acceptance (four checks, six provider calls) passed after the fix. The pinned reference separately verifies that a directory at Cursor's settings filename does not load child hooks.

This is one newly evidenced implementation occurrence; no recurring constraint is created.

Shared integration repeats the 31-test / 140-assertion gate, Core and Apexo typechecks, and native CLI four-check / six-provider-call acceptance successfully. Rebuilt shared Desktop remains pending.
