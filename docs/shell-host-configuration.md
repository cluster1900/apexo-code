# Grok Shell Host Configuration

The Grok runtime profile reads `toolset.bash` from the normal Apexo configuration layers. The CLI and Desktop share the same tool adapter and configuration resolver. Host settings govern the foreground wait; reaching that wait promotes the existing process to the background instead of killing or restarting it.

This verified implementation currently belongs to the compatibility runtime. A later native audit reproduced that V1 migration drops `toolset`; native configuration and Bash do not consume these options yet. [BUG-20261015-352](testing/persistence/native-shell-host-config-migration.md) tracks the missing native path. The CLI/Desktop results below do not establish native V2 host-setting parity.

```json
{
  "toolset": {
    "bash": {
      "default_block_until_ms": 30000,
      "max_block_until_ms": 60000,
      "max_timeout_secs": 300
    }
  }
}
```

| Setting | Semantics |
| --- | --- |
| `default_block_until_ms` | Default when the model omits its wait. Defaults to 30,000 milliseconds. Zero starts immediately in the background. The effective default never exceeds the effective maximum. |
| `max_block_until_ms` | Positive integer ceiling in milliseconds. Omitted or zero adds no dedicated ceiling. |
| `max_timeout_secs` | Positive finite seconds add a foreground ceiling, rounded to milliseconds with a minimum of one millisecond. Non-positive values are ignored. This never becomes a background kill timer. |

The effective maximum is the minimum of the positive configured limits and the existing 36,000,000 millisecond absolute ceiling. Explicit model waits take precedence over the configured default; zero always remains zero. Oversized requests are clamped during execution. The model-facing schema and description advertise the effective maximum and default. Ordinary Apexo-profile Shell behavior is unchanged.

This matches the pinned current-contract `BashParams` resolver. The pinned official shell configuration serializer exposes `default_block_until_ms` and `max_timeout_secs`; `max_block_until_ms` is a tool-server parameter, not a field serialized by that shell configuration struct. Apexo exposes all three through `toolset.bash`. This does not import Grok's TOML files or claim support for every historical Bash contract and host option.

## Verification

Run the following from `packages/apexo` with the repository's pinned Bun:

- `GITHUB_ACTIONS=false bun test test/tool/grok-shell-config.test.ts test/tool/grok-build-background.test.ts test/tool/grok-build.test.ts`: 37 passed, zero failures, 157 assertions. Includes default/cap precedence, zero handling, seconds rounding, the absolute limit, invalid configuration, and unchanged process kill deadlines.
- `bun script/grok-shell-config.mjs cli`: nine real execution scenarios passed. Checks provider-visible schemas, timed promotion, background survival past the host ceiling, complete output, and Session cleanup.
- `bun script/grok-shell-config.mjs desktop`: nine real execution scenarios passed against the final integrated production Electron build, with the same schema, timing, process-survival, and completion assertions as CLI.
- `bun script/grok-shell-config-official.mjs`: installed Grok 1.0.52 passed three scenarios through an isolated local model endpoint and real ACP execution. The host default and seconds cap appeared in its schema; the process survived and completed after backgrounding.
- Pinned official source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`: `single_knob_tests` passed 19 tests, covering the direct tool-server cap as well as current-contract behavior.

The official description wording mismatch in the first fixture run is recorded in [BUG-20261014-040](testing/test-fixtures/shell-host-default-description.md). No ten-hour wall-clock run or Windows/Linux execution is claimed by these short-duration and deterministic-clock checks. Other official host settings, legacy contract compatibility, and the exact background lifetime boundary remain separate parity work.
