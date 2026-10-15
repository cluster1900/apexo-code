# BUG-20261015-296: Clear fixture retained a consumed pre-Dream observation path

- Scope: Native Memory operation UI acceptance construction.
- Observed: After real Dream publication and cancellation checks succeeded, the browser fixture attempted to modify its original capture observation and received ENOENT before clicking Clear.
- Expected: Dream consumes the source observations and publishes its reviewed topic. A later clear/hash test must select a currently published file from the canonical notes catalog.
- Cause: The fixture retained the original observation path across Dream instead of querying the newly published topic. This was a fixture-state assumption, not data loss or a clear implementation defect.
- Correction: Select the actual `topics/ui-dream-1.md` path returned by the real notes API after Dream, then use that file for changed-hash and explicit-clear checks. Preserve the earlier source path for pre-Dream assertions only.
- Verification: Corrected browser and native-window runs passed the changed-preview rejection and subsequent confirmed clear against the actual Dream-published topic. All four terminal mode/size combinations also passed reviewed clear and actual file removal. Dream source consumption remains expected behavior.
