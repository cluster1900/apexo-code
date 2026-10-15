# Private Process UI snapshot copy lacked a destination parent

- **Bug ID:** BUG-20261015-189.
- **Scope:** One private validation-snapshot construction episode, before product edits or tests.
- **Observed:** The clone-copy of a package dependency directory failed with “No such file or directory” because its destination package directory did not exist. Source selection had omitted an untracked placeholder package while dependency discovery still found its node_modules directory.
- **Expected:** Every copied dependency directory has an explicitly created destination parent; source and manifests remain a coherent checkpoint.
- **Root cause:** The snapshot authoring script assumed that copying selected source files necessarily created every dependency destination parent. This is a fixture setup error, not a product failure or a stale-source inference.
- **Fix:** Create each destination parent before clone-copying its dependency directory. Re-copy and hash the complete selected source checkpoint, preserving workspace versus vendored dependency identities and the actual Workflow interpreter artifact.
- **Verification:** The corrected snapshot completed with 5,500 source/manifest files. Shared before/after hashes and copied-source hashes were equal. No shared source or generated output was changed. Later UI tests are separate evidence, not the fix for this construction error.
