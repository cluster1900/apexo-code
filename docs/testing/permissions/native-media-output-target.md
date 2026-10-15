# BUG-20261015-115: Native media authorized a wildcard instead of the output resource

- **Scope:** Native and compatibility media tool output authorization in the current feature worktree; not a released-regression claim.
- **Observed:** A real native Session configured with an `edit` deny for `*.png` still made one image API request. The regression expected zero and failed before further assertions.
- **Expected:** Extension-specific output denies prevent outbound media work and file creation.
- **Root cause:** The tool passed the literal directory `/*` string as the permission resource. That resource did not match the actual future PNG filename. FileMutation performs the write but does not independently authorize it.
- **Fix:** Reserve one random basename and resolve exact candidate paths before outbound work. Video authorizes its MP4 target; image generation authorizes each supported PNG/JPEG/WebP candidate because response format is not known yet. A denial on any candidate fails closed before billed work. The final path is resolved again and must match its preauthorized canonical path and resource before the existing owned file commit. No network wait is placed inside the lifecycle mutation lease.
- **Reproduction:** From `packages/apexo`, run `bun test test/e2e/v2-media.e2e.test.ts -t extension-denied`. Before the fix: zero passing, one failing, actual API calls one versus expected zero.
- **Verification:** The unchanged scoped regression passed after the fix. The combined native media suite passed 14 tests / 104 assertions, including zero outbound calls and no output for the extension deny. Core typecheck passed after the separately recorded conditional Effect inference correction. Final CLI and package type results are listed in the feature document.
- **Occurrences:** Two confirmed implementation paths with the same incorrect permission resource; no third independent occurrence or recurring constraint is inferred.

## Shared native and compatibility checkpoints

After integration, the native suite passed 14 tests / 104 assertions, all 21 package typechecks passed, and CLI plus rebuilt Desktop each passed five checks / eight language-provider calls. The earlier read-denial whole-test timeout remains separately recorded and is not attributed to the permission fix.

Review of the independent compatibility implementation found the same directory-wildcard resource mistake. A real isolated CLI Session configured with `edit` denies for `*.png` and `*.mp4` invoked `image_gen` and still made one outbound image request; the zero-request assertion failed. The fixture uses the actual compatibility permission service and tool runner. No mock policy evaluation is used.

The compatibility repair reserves one basename and authorizes its exact PNG/JPEG or MP4 candidates before media HTTP, then writes only a candidate from that reserved set. Image format denial is intentionally conservative. Run `bun script/grok-media-permission.mjs cli` or `desktop` from `packages/apexo`. This is the second confirmed implementation path with the same resource-versus-pattern mistake; no third occurrence or constraint is inferred. Compatibility post-fix verification passed:

- `bun test test/tool/grok-build-media.test.ts`: seven tests / 39 assertions.
- Apexo `bun typecheck`: passed.
- `bun script/grok-media-permission.mjs cli` and `desktop`: four denial checks each, zero media requests and no generated files; seven/eight language fixture calls respectively. These counts do not imply identical auxiliary scheduling.
- `bun script/grok-media-parity.mjs cli` and `desktop`: each passed all four tools, both media commands and explicit S3 output with separate GET credentials after the repair. Desktop was rebuilt after the source change.
- `APEXO_GROK_BUILD_BIN=<installed executable> bun script/grok-media-official.mjs`: all four isolated installed media scenarios passed again. Official ACP did not advertise either media command; output-permission denial is an Apexo authorization regression, not an asserted official per-file-denial equivalence.

All owned processes exited and were reaped. No generated API or renderer source changed in this permission repair.
