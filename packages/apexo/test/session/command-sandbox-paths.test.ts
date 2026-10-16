import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { CommandSandboxPaths } from "@apexo/core/command-sandbox/paths"
import { CommandSandboxPolicy } from "@apexo/core/command-sandbox/policy"
import { Bwrap } from "@apexo/core/command-sandbox/linux"

test("protected hardlinks and symbolic authority roots are refused before any launch", async () => {
  const root = await mkdtemp(path.join(homedir(), ".apexo-policy-"))
  try {
    const workspace = path.join(root, "work")
    await mkdir(workspace)
    const config = path.join(workspace, "apexo.json")
    await writeFile(config, "{}")
    await link(config, path.join(workspace, "alias"))
    const failure = await Effect.runPromise(
      CommandSandboxPaths.resolve({ workspace, profile: "workspace", protected: [config] }).pipe(Effect.flip),
    )
    expect(failure.code).toBe("unsafe_path")
    await symlink(workspace, path.join(root, "symbolic"))
    const symbolic = await Effect.runPromise(
      CommandSandboxPaths.resolve({ workspace: path.join(root, "symbolic"), profile: "workspace", protected: [] }).pipe(
        Effect.flip,
      ),
    )
    expect(symbolic.code).toBe("unsafe_path")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a renamed and replaced authority directory cannot reuse a captured path policy", async () => {
  const root = await mkdtemp(path.join(homedir(), ".apexo-policy-"))
  try {
    const workspace = path.join(root, "work")
    await mkdir(workspace)
    const policy = await Effect.runPromise(
      CommandSandboxPaths.resolve({ workspace, profile: "workspace", protected: [path.join(workspace, "apexo.json")] }),
    )
    expect(policy.profile).toBe("workspace")
    if (CommandSandboxPolicy.isOff(policy)) throw new Error("Unexpected off policy")
    await Effect.runPromise(CommandSandboxPaths.verify(policy))
    await rename(workspace, path.join(root, "old"))
    await mkdir(workspace)
    const failure = await Effect.runPromise(CommandSandboxPaths.verify(policy).pipe(Effect.flip))
    expect(failure.code).toBe("unsafe_path")
    expect(Object.isFrozen(policy.identities)).toBe(true)
    expect(Object.isFrozen(policy.identities[0])).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("sandbox.toml rejects invalid deny globs, relative escapes, and unknown custom profiles with invalid_policy", async () => {
  const root = await mkdtemp(path.join(homedir(), ".apexo-policy-toml-"))
  try {
    const workspace = path.join(root, "work")
    await mkdir(path.join(workspace, ".grok"), { recursive: true })

    const unknownProfile = await Effect.runPromise(
      CommandSandboxPaths.resolve({ workspace, home: root, profile: "nonexistent-profile", protected: [] }).pipe(
        Effect.flip,
      ),
    )
    expect(unknownProfile.code).toBe("invalid_policy")

    await writeFile(
      path.join(workspace, ".grok", "sandbox.toml"),
      ['[filesystem]', 'deny = ["foo/**bar"]'].join("\n"),
    )
    const badGlob = await Effect.runPromise(
      CommandSandboxPaths.resolve({ workspace, home: root, profile: "workspace", protected: [] }).pipe(Effect.flip),
    )
    expect(badGlob.code).toBe("invalid_policy")

    await writeFile(
      path.join(workspace, ".grok", "sandbox.toml"),
      ['[filesystem]', 'deny = ["../outside.txt"]'].join("\n"),
    )
    const relativeEscape = await Effect.runPromise(
      CommandSandboxPaths.resolve({ workspace, home: root, profile: "workspace", protected: [] }).pipe(Effect.flip),
    )
    expect(relativeEscape.code).toBe("invalid_policy")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Linux Bwrap.prepare constructs unshare-net, strict/workspace mounts, deny mounts, and confirmation marker", () => {
  const workspace = "/home/tester/workspace"
  const temporary = "/tmp/apexo-tmp"
  const home = "/home/tester"
  const strictPrepared = Bwrap.prepare({
    profile: "strict",
    base: "strict",
    network: "off",
    workspace,
    temporary,
    home,
    cwd: workspace,
    shell: "/bin/bash",
    command: "echo hi",
    protected: [`${workspace}/apexo.json`],
    ancestors: [],
    readOnly: ["/opt/shared-ro"],
    readWrite: ["/opt/shared-rw"],
    denyLiterals: [`${home}/.ssh`],
  })
  const strictJson = JSON.stringify(strictPrepared.args)
  expect(strictJson).toContain("--die-with-parent")
  expect(strictJson).toContain("--unshare-pid")
  expect(strictJson).toContain("--unshare-net")
  expect(strictJson).toContain("/opt/shared-ro")
  expect(strictJson).toContain("/opt/shared-rw")
  expect(strictJson).toContain(`${home}/.ssh`)
  expect(strictJson).not.toContain('"--ro-bind","/","/"')

  const devboxPrepared = Bwrap.prepare({
    profile: "devbox",
    base: "devbox",
    network: "unrestricted",
    workspace,
    temporary,
    home,
    cwd: workspace,
    shell: "/bin/bash",
    command: "echo devbox",
    protected: [],
    ancestors: [],
  })
  const devboxJson = JSON.stringify(devboxPrepared.args)
  expect(devboxJson).not.toContain("--unshare-net")
  expect(devboxJson).toContain('"--ro-bind","/","/"')
  expect(
    devboxPrepared.confirm({
      command: "bwrap",
      exitCode: 0,
      stdout: Buffer.from("forged\n"),
      stderr: Buffer.alloc(0),
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
  ).toBeUndefined()
  const marker = devboxPrepared.args[devboxPrepared.args.length - 3]!
  const confirmed = devboxPrepared.confirm({
    command: "bwrap",
    exitCode: 0,
    stdout: Buffer.from(`${marker}real-stdout\n`),
    stderr: Buffer.alloc(0),
    stdoutTruncated: false,
    stderrTruncated: false,
  })
  expect(confirmed?.stdout.toString("utf8")).toBe("real-stdout\n")
})

