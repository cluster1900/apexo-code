# Native Task nesting (foreground and background)

Status: integrated with shared tests, types, generated consistency, source CLI, rebuilt Desktop backend and isolated installed-reference acceptance.

Native `task.maxDepth` (and `subagent.max_nesting_depth`) controls the number of Task child levels below an ordinary Session. The default is `1` (or `2` when configured via `subagent.max_nesting_depth`); `2` allows a child to delegate to a grandchild. Values must be integers from `1` through `16`. Native and migrated V1 configuration use the same field. An explicit invalid higher-priority Task selection blocks new Task trees instead of restoring a broader lower-priority value. A rejected configuration document does not recover its permissions or providers.

The first child captures the root Session ID, original Created proof, depth and maximum depth in its private Task ownership record. Descendants inherit that immutable limit. Same-child follow-up, including after a process restart, retains it; changing configuration affects newly created trees. A later invalid depth selection likewise does not rewrite a verified existing tree; permissions, headless policy, sandbox and Created ownership are still checked. Historical records without this proof remain non-delegating. Public Session metadata cannot grant or widen delegation.

Both foreground and background nested Task launches (`run_in_background: true`) are supported within the configured depth limit (`R05`). The existing native child runner and coordinator own every level; there is no separate model loop. When an intermediate child spawns a background grandchild, the child remains active (`activeNestedCount > 0`) while its initial turn completes and settles only after its owned background descendants complete and wake it for synthesis. Task output (`task_output`), active messaging (`task_message` / `send_subagent_message`), and cascading cancellation (`task_cancel`) operate across the caller's owned descendant subtree while rejecting foreign or sibling Sessions. Public prompt/resume cannot steer a managed child. Parent deletion joins the descendant chain before same-ID recreation, and late responses cannot write into recreated Sessions.

Configured agent and inherited permission boundaries continue through every descendant. Headless input policy is inherited through foreground children; automatic consent cannot approve a hard deny. An ordinary Goal worker can delegate within its captured depth, with all descendant stream and compaction usage charged to its original attempt. Goal planning, verification, strategy and summary children remain separate managed roles and cannot delegate. Workflow nested Tasks still require a future logical budget reservation.

## Reference evidence

Pinned Grok source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` uses root depth zero and a default maximum depth of one. It accepts `[subagents].max_depth` and an environment override. Apexo uses its own canonical `task.maxDepth` and a documented maximum of sixteen; it does not depend on the Grok executable.

An isolated installed Grok 1.0.52 comparison passed three cases with eleven conversation and seventeen auxiliary requests: default child catalog without Task, configured depth two with one actual grandchild, and explicit active-message feature enablement advertising `send_subagent_message`. The last case proves advertisement only; active delivery execution has not yet been verified. Installed headless JSON aggregates child and parent text. Title requests were classified separately by their actual Responses or Chat Completions protocol.

## Verification

The final private regression gate passed **29 tests / 321 assertions across nine files**, including configuration precedence, real SQLite lineage/reopen, default and depth-two provider chains, nested-background/cap refusal, direct-parent management, public admission rejection, parent deletion and all-ID reuse, headless hard deny/no file, existing Task/background/admission behavior, and Goal known/unknown usage. Known nested Goal totals were 13 tokens and 15 with compaction; a held grandchild pause retained `user_paused`, eight known tokens and `usageIncomplete: true`, without late accounting.

`bun script/grok-native-task-nested.mjs cli` passed **six checks / twenty provider calls**, including process restart, same-child follow-up retaining the original depth, newly created trees following current depth one, invalid higher-priority selection creating no child, and verified old trees continuing under their original depth policy despite that invalid new-tree configuration. Reads and rejected foreign/public operations added no provider calls.

Earlier failed authoring checks are preserved under BUG288 (catalog versus inherited leaf authority), BUG289 (canonical Goal status), and the second BUG112 occurrence (query delimiter). These were corrected fixture assumptions, not product permission/status/query changes.

Final Core and Apexo package typechecks passed. The portable installed comparison script also passed three cases with eleven conversation and seventeen auxiliary requests, all owned processes reaped. Packaged Desktop remains pending root integration and a coordinated artifact; existing backend acceptance is not represented as this slice's rebuilt-artifact evidence.

Run the native matrix from `packages/apexo` with `bun script/grok-native-task-nested.mjs cli` or `desktop`. The installed comparison is `bun script/grok-native-task-advanced-official.mjs`; it requires macOS sandbox isolation and accepts an explicit `GROK_BIN` override. No upstream results count as native implementation tests.

## Shared integration checkpoint

The reviewed 25-file handoff is integrated with every original/final hash checked; the two already integrated recurring-rule records matched their final hashes. The shared nine-file gate passes **29 tests / 321 assertions**, including real descendant execution, deletion and ID reuse, inherited headless denial, and Goal accounting/cancellation. Client and legacy SDK generation and public configuration-schema generation pass. All 21 workspace typecheck tasks pass without cache hits, the fresh Desktop build passes, and isolated-index Client generated consistency passes without changing the real Git index.

The installed comparison was hardened to classify title and dashboard work separately, require the actual Chat Completions/read-file conversation catalog, and fail on an unknown POST or captured provider-callback error. Its fresh shared run passes **three cases / eleven conversation and seventeen auxiliary requests** with all case exits zero. This confirms the default depth, actual configured grandchild and optional active-message catalog only. It does not prove native active delivery, which remains a separate implementation stage.

Shared `bun script/grok-native-task-nested.mjs cli` and `desktop` each pass **six checks / twenty provider calls**, including an actual process restart and retained private depth policy. The Desktop command used the freshly rebuilt backend. No App/TUI code changed in this slice, and these backend results do not claim new native-window coverage. Active messages, nested background execution, transcript forks, worktree delegation and broader managed roles remain open.
