# BUG-20261101-703 — Linux CI `apexo sandbox` test matched lowercase `"command sandbox"` instead of probing `bwrap` namespace availability

- **Bug ID**: `BUG-20261101-703`
- **Category**: Test fixtures (`test-fixtures`)
- **Affected Scope**:
  - `packages/apexo/test/v2/sandbox-proxy-and-attempts.test.ts`
- **Occurrences**: 1 Linux CI episode (`apexo tests (2/6)` on `ubuntu-latest`).

## Observed Behavior

On GitHub Actions `ubuntu-latest` (`apexo tests (2/6)`), `sandbox-proxy-and-attempts.test.ts` failed at `JSON.parse(directBypass.stdout)` with `SyntaxError: JSON Parse error: Unexpected EOF` because `directBypass.stdout` was empty when `apexo sandbox` failed closed on a runner without usable unprivileged `bwrap` namespaces.

## Expected Behavior

When `process.platform === "linux"` and `bwrap` is absent or kernel/AppArmor policy forbids creating the required `--unshare-pid --unshare-net` sandbox (`kernel.apparmor_restrict_unprivileged_userns = 1`), the test should detect `bwrap` unavailability explicitly and assert that `apexo sandbox` fails closed (non-zero exit code, empty stdout, no secret leak), while running the live OS kernel sandbox assertions whenever `seatbelt` (macOS) or `bwrap` (Linux with unprivileged namespaces) is available.

## Reproduction Steps

Run on a Linux host without `bwrap` or with unprivileged user namespaces restricted, in `packages/apexo`:

```sh
bun test test/v2/sandbox-proxy-and-attempts.test.ts
```

## Root Cause

`sandbox-proxy-and-attempts.test.ts` inferred `bwrap` unavailability from `directBypass.stderr.includes("command sandbox")`, whereas `CommandSandbox.Service.exec` (`packages/core/src/command-sandbox.ts`) formats spawn failures as `Sandboxed command failed to execute: ...` (capitalized `"Sandboxed command"`, which does not contain `"command sandbox"`). That caused `sandboxUnavailable` to evaluate to `false` and fall through to `JSON.parse(directBypass.stdout)`.

## Fix

Replaced the brittle `stderr` substring heuristic in `packages/apexo/test/v2/sandbox-proxy-and-attempts.test.ts` with a direct `bwrap` capability probe matching `Bwrap.prepare`'s system `PATH` and namespace/mount flags (`--die-with-parent --unshare-pid --unshare-net --ro-bind / / --dev /dev --proc /proc -- /bin/true`). When `kernelSandboxAvailable` is `false` on Linux, the test explicitly verifies fail-closed CLI behavior (`exitCode !== 0`, empty `stdout`, non-empty `stderr`, and no payload execution); when `true`, it executes the full kernel sandbox suite.

## Verification

- `cd packages/apexo && bun typecheck`: passed.
- `cd packages/apexo && bun test test/v2/sandbox-proxy-and-attempts.test.ts`: 2 pass, 0 fail (77 `expect()` calls).
