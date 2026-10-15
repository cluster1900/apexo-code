# BUG-20261015-049: Host acceptance used a native-only config through a compatibility route

- **Scope:** `script/grok-workflow-host.mjs` setup for a Session permission grant.
- **Status:** Fixed and verified.
- **Occurrences:** One fixture-authoring episode.
- **Observed:** Native Workflow scenarios loaded the pure V2 config, but the added compatibility Session PATCH failed with `ConfigInvalidError` before changing permissions.
- **Expected:** A fixture deliberately exercising both loaders must provide a document supported by both, while preserving its intended agent policy.
- **Reproduction:** Run the host fixture with native `providers`, `permissions`, and `agents` entries, then invoke the compatibility `/session/:id` PATCH route.
- **Root cause:** That compatibility route constructs the V1 config loader, which explicitly rejects V2 permission fields. The document was pure V2, so this is not another occurrence of mixed-key V1 auto-detection silently ignoring V2 entries in BUG-20261014-252.
- **Fix:** Use one consistent V1 document, including `agent` and `permission` maps, which the native loader already migrates. Keep native Workflow execution and the real compatibility grant route.
- **Verification:** CLI and rebuilt Desktop each passed all six host checks, including the actual grant followed by denial preservation. No config decoder or product permission rule was relaxed.
