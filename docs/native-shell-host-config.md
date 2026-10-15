# Native Shell foreground wait configuration

Native configuration now preserves and consumes the existing `toolset.bash` foreground wait settings. Both native configuration and migrated compatibility configuration use the same schema:

```json
{
  "toolset": {
    "bash": {
      "default_block_until_ms": 40,
      "max_block_until_ms": 80,
      "max_timeout_secs": 0.2
    }
  }
}
```

For an ordinary Session with `toolset.bash` configured, omitting `block_until_ms` selects `default_block_until_ms`, or 30,000 ms when that field is absent. An explicit `block_until_ms` overrides the default. `background: true` selects zero wait. Positive waits are clamped by the lowest positive configured ceiling and the absolute ten-hour wait ceiling. Zero `max_block_until_ms` and non-positive `max_timeout_secs` add no ceiling. Positive seconds convert to rounded milliseconds, with a one-millisecond minimum. Zero wait means return after successful spawn.

The existing Session-owned process executor runs the command. If it is still running when the wait expires, it promotes that same process and returns its receipt; it does not restart or kill it. A command completing before the wait returns its completed receipt without a background completion wake. Original command permission checks, sandbox preparation, process ownership, exact-invocation retry checks, cancellation and one-time completion delivery remain authoritative. The resolved wait is part of the immutable request, so conflicting retries cannot silently reinterpret or respawn a command.

## Foreground-only contexts and lifetime

Implicit host defaults do not create background authority for headless inputs, managed children or active Goal attempts. Those contexts retain the existing foreground Bash path and may run ordinary allowed commands. Explicit background or wait requests still face the existing ownership restrictions. The process executor rechecks authority during admission, so a prior eligibility observation is not a capability to bypass a later restriction.

Without `toolset.bash`, existing native behavior is unchanged: explicit background/block requests use process receipts, while ordinary calls use foreground execution. The native tool's `timeout` remains a process-lifetime limit in milliseconds. Ordinary foreground calls use two minutes by default and at most ten minutes. Eligible owned execution uses a ten-hour safety cap when timeout is omitted or zero; positive deadlines may extend to that cap. Zero never grants background authority. Foreground-only calls reject zero or values above their ten-minute ceiling before spawning. `max_timeout_secs` is a foreground **wait cap**, despite its name; it does not replace that lifetime. Thus a long requested wait can still end earlier because the separately configured process timeout expires. Apexo deliberately keeps the native timeout separate from foreground wait; it does not copy the reference current contract's legacy timeout folding.

## Scope and evidence

This is the bounded configuration repair for [BUG-20261015-352](testing/persistence/native-shell-host-config-migration.md). Command prefixing and output-limit translation are covered below. Capped long-lived ownership is covered below; the overall G11 parity assessment remains separately tracked. Generic model output bounds continue to belong to ToolRegistry; the host preview policy uses that same boundary and adds no second executor.

The fixed reference `xai-grok-tools/src/implementations/grok_build/bash/mod.rs` defines the foreground default, seconds conversion and wait-cap/promotion rules. Installed-runtime comparison is isolated and recorded separately; it is never a production dependency or proof of Apexo execution.

Validation includes a failing migration control and a real native omitted-wait control, configuration/schema checks, actual processes that survive the wait and retain the same PID, permission denial before spawn, foreground headless fallback, early completion, and the existing process retry/cancellation/ownership suite. `grok-native-shell-config.mjs` exercises six cases against either the source CLI or the rebuilt Desktop backend. `script/schemas.ts` regenerates the public compatibility JSON schema canonically; no tracked schema output changes because those fields were already exposed there. The native JSON-schema document is independently checked for the retained fields.

## Command prefixes and output previews

`toolset.bash.cmd_prefix` is an optional setup command. On POSIX, a configured value is joined to the requested command with `&&`, so a failed setup prevents the requested command from running. Setup can change the working directory or exported environment of the same shell. An explicitly empty prefix retains shell syntax behavior; it is not silently treated as absent. Permissions, path advisories, selected sandbox enforcement and immutable process receipts use the complete joined command. Cancellation joins the same owned process chain. Windows shell invocation remains subject to the existing native platform limitations; acceptance here exercises POSIX.

`toolset.bash.output_byte_limit` is a nonnegative safe integer counting Unicode code points, despite its historical name. An omitted value preserves the existing native output behavior. When command output exceeds the configured count, the model preview keeps `floor(limit / 2)` code points from each end and includes a managed output-file notice. Zero keeps no command-output characters. The entire captured command output is retained in that file, subject to the existing process-capture safety limit; this does not promise unlimited disk streaming. Process receipts keep their original captured output. Status and process identity stay separate from the command-preview cap. The existing generic ToolRegistry/ToolOutputStore byte and line limits remain authoritative over the final model content, including notices and metadata.

The command and output budget are captured before permission I/O; output settlement does not reread the Shell configuration. An internal typed policy travels through opaque native Tool settlement to the canonical output store. It is not a model argument or a field in public structured output. The fixed reference distinguishes host `BashParams` from model `BashToolInput`; installed catalog and execution comparisons confirm that distinction.

[BUG359](testing/runtime/native-shell-prefix-output.md) records the missing-feature control and acceptance. Owned Shell lifetime is capped as described below; this does not claim unlimited execution or close the overall G11 assessment.

## Owned process lifetime

An eligible owned Shell call (`background`, explicit `block_until_ms`, or an eligible host foreground-wait default) records `timeoutMs: 36000000` when the native timeout is omitted or zero. A positive timeout records that exact value up to the same ten-hour cap. Larger values are rejected by the native tool schema. Configured wait ceilings do not lower this lifetime. The existing Session process executor owns the deadline, completion and cleanup; there is no replacement runner or additional background timer.

Ordinary foreground calls keep their two-minute default and ten-minute maximum. Managed children, active Goals and headless inputs retain their existing ownership restrictions. An implicit host wait remains ordinary foreground execution in those contexts, and zero does not turn it into background work. Accepted Stop, process cancellation and Session deletion continue to join the same ownership chain. Exact invocation retries compare the captured resolved deadline.

The fixed reference's background resolution plus terminal backstop motivates the explicit ten-hour safety cap. Its current contract discards the legacy timeout when an explicit zero block is present; Apexo preserves its separate positive lifetime deadline. [BUG361](testing/runtime/native-shell-owned-lifetime.md) records the negative controls, actual deadline/PID checks and this intentional native dialect difference.

## Shared composition checkpoint

Source CLI and the final unified Desktop each pass two prefix/output checks and four lifetime checks. All four lifetime scenarios observe the actual child PID and verify it is reaped. The shared lifetime test file passes ten tests / 34 assertions; the preceding prefix/output, ownership and wait-setting gate passes 33 / 311. All 21 workspace typechecks and the unified App/Desktop builds pass. The original combined-gate readiness timeout remains an open investigation under [BUG358](testing/test-stability/native-shell-config-provider-timeout.md). No test runs a process for ten wall-clock hours; durable deadline selection, short real expiry and cancellation are the verified bounds.
