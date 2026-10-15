# Plugins Localized Settings Tab Readiness

- **Bug ID:** BUG-20261015-017
- **Scope:** Existing production-browser Plugins acceptance script.
- **Status:** Fixed and verified; no product code change.
- **Independent occurrences:** 1 authoring episode, with an unchanged diagnostic reproduction.

## Observed and expected behavior

After changing the locale to Simplified Chinese, reloading, and pressing the
Settings shortcut, the next name-based click reported that the Plugins tab did
not exist. The diagnostic snapshot immediately afterward contained the correctly
localized tab and selected language. The script should wait for the target
localized Settings tab before attempting to click it.

## Reproduction and root cause

Run `bun script/grok-plugins-ui.mjs cli --sources-only` from `packages/apexo`
without a rendered-tab readiness check. Waiting for the underlying Session
Memory action only proves the Session page is mounted; it does not prove the
subsequently opened Settings dialog and its localized tab are ready.

The first failure occurred after successful composer benchmark samples. A second
unchanged diagnostic run captured the correctly localized Settings dialog after
the premature click failure. These reproduce one fixture mistake; they are not
independent implementations of the mistake.

## Fix and verification

Before every name-based Plugins tab click, wait for a rendered tab whose complete
text matches the intended locale label. No fixed sleep, product text change, or
weakened catalog assertion was introduced.

The corrected command passed **14 checks** with successful process exit and all
owned processes reaped: catalog opening, source add/remove, Simplified Chinese,
Traditional Chinese, German, Japanese, Arabic, Hindi, Polish, Thai, Turkish, and
small-screen overflow. The narrower `--sources-only` run does not claim the
separate install/download checks.
