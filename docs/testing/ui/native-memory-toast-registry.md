# Native Memory guidance used an inactive toast registry

- **Bug ID:** BUG-20261015-176.
- **Scope:** Draft App native Memory command guidance.
- **Observed:** The production browser passed thirteen passive-management checks, including all three locales, held-preview cancellation and hash-conflict handling. Selecting the retained native `/flush` entry consumed the command but displayed no unsupported-operation guidance. The captured active V2 layout had no toast.
- **Expected:** Local command guidance is visible in the active App layout, with no provider or compatibility-management call.
- **Root cause:** The new Memory component imported `showToast` directly from the UI package's legacy Kobalte registry. The active App V2 layout renders the alternate toast registry through the existing application utility. This is separate from an assertion that selects the wrong rendered toast markup.
- **Fix:** Import the existing application `showToast` utility, which selects the active registry. No global registry, layout, backend or permission behavior changed.
- **Verification:** Production browser passed fifteen checks across en/zh/zht after rebuilding. The actual native window passed sixteen checks, including added catalog-search coverage. Both used five setup provider calls and zero additional UI calls, and all owned processes were reaped. Unsupported guidance was visibly rendered; the original failure and screenshots remain in the evidence.

The final expanded production-browser and rebuilt native-window matrices each passed eighteen checks across en/zh/zht, retaining zero UI provider calls after five setup calls. Active screenshots confirm readable translated content; all owned processes were reaped.
