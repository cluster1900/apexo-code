# BUG-20261014-118: Workflow dashboard reversed newest-first results

- Scope: new Workflow App and terminal run lists; two mini PTY resume-editor timeouts observed.
- Observed: after creating a budget-limited run, the resume key did not open its budget editor. The selected first row was the older completed run.
- Expected: the newest run remains first and selected after launch; resume acts on the selected eligible run.
- Reproduction: complete one workflow, launch a second with insufficient budget, and press resume without changing selection.
- Root cause: the related-runs API already sorts by descending creation time, but the UI reversed that result. The terminal retained index zero, selecting the oldest completed run.
- Diagnosis history: the first failure was tentatively attributed to pending refresh. Adding a loading-settled wait did not fix the second run; source inspection then confirmed the ordering mismatch. The initial synchronization hypothesis was not proven.
- Fix: removed the redundant reverse in App and TUI, preserving the API ordering.
- Verification: mini and fullscreen each passed ten real PTY checks, including selection of the newest budget-limited run and increased-budget resume. The updated production browser and native Desktop each passed eleven checks; screenshots visually confirmed newest-first run ordering.
