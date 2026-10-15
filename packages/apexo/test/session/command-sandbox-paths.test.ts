import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { CommandSandboxPaths } from "@apexo/core/command-sandbox/paths"

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
    if (policy.profile === "off") throw new Error("Unexpected off policy")
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
