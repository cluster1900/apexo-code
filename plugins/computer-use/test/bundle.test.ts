import { expect, test } from "bun:test"
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build, permissionProfile, toolName, tools } from "../script/build.mjs"
import { McpTools } from "../../../packages/core/src/mcp-tools"
import { PluginBundle } from "../../../packages/core/src/plugin-bundle"
import { PermissionV2 } from "../../../packages/core/src/permission"

test("the installable manifest expands package/data paths using the actual host loader", async () => {
  const source = path.resolve(import.meta.dir, "..")
  const bundle = await PluginBundle.read(source, undefined, { native: true, data: "/private/plugin-data" })
  expect(bundle.config.mcp?.["computer-use:desktop"]).toMatchObject({
    type: "local",
    command: [path.join(source, "bin/mcp")],
    environment: { AGENT_DESKTOP_HOME: "/private/plugin-data/agent-desktop" },
  })
  expect(bundle.skills.map((skill) => skill.name)).toEqual(["computer-use:computer-use"])
})

test("the generated policy uses canonical host names and denies unlisted composite/admin tools", () => {
  const profile = permissionProfile()
  const defaults = [{ action: "*", resource: "*", effect: "allow" }] as const
  for (const tool of tools) {
    expect(toolName(tool)).toBe(McpTools.name("computer-use:desktop", tool))
    expect(
      PermissionV2.evaluate(toolName(tool), "*", defaults, profile.permissions, profile.agents.build.permissions)
        .effect,
    ).toBe("ask")
    expect(PermissionV2.evaluate(toolName(tool), "*", defaults, profile.permissions).effect).toBe("deny")
  }
  for (const tool of [
    "desktop_launch",
    "desktop_batch",
    "desktop_sandbox_exec",
    "desktop_clipboard_get",
    "desktop_session_start",
    "desktop_press",
  ])
    expect(
      PermissionV2.evaluate(toolName(tool), "*", defaults, profile.permissions, profile.agents.build.permissions)
        .effect,
    ).toBe("deny")
})

test("corrupt archives fail before publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-computer-use-test-"))
  try {
    await Bun.write(path.join(root, "release.tar.gz"), "not the pinned release")
    await expect(
      build({ arch: "arm64", archive: path.join(root, "release.tar.gz"), output: path.join(root, "bundle") }),
    ).rejects.toThrow("checksum mismatch")
    expect(await Bun.file(path.join(root, "bundle/.mcp.json")).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform !== "darwin")(
  "launcher uses adjacent executable, a fresh namespace, literal paths and no stdout noise",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apexo computer use ' test-"))
    try {
      await mkdir(path.join(root, "bin"))
      await cp(path.resolve(import.meta.dir, "../bin/mcp"), path.join(root, "bin/mcp"))
      await Bun.write(
        path.join(root, "bin/agent-desktop"),
        '#!/bin/sh\ntest "$AGENT_DESKTOP_MACOS_HELPER_PATH" = "$0-macos-helper" || exit 2\nprintf \'%s\\n\' "$@"\n',
      )
      await Bun.write(path.join(root, "bin/agent-desktop-macos-helper"), "#!/bin/sh\nexit 0\n")
      await Promise.all(
        ["mcp", "agent-desktop", "agent-desktop-macos-helper"].map((file) =>
          chmod(path.join(root, "bin", file), 0o755),
        ),
      )
      const run = () =>
        Bun.spawnSync([path.join(root, "bin/mcp")], {
          env: {
            PATH: "/nonexistent",
            AGENT_DESKTOP_HOME: path.join(root, "data"),
            AGENT_DESKTOP_MACOS_HELPER_PATH: "/wrong/inherited/helper",
          },
        })
      const first = run()
      const second = run()
      expect(first.exitCode).toBe(0)
      expect(first.stderr.toString()).toBe("")
      expect(first.stdout.toString()).toMatch(/^mcp\n--session\napexo-[A-F0-9-]+\n$/)
      expect(first.stdout.toString()).not.toBe(second.stdout.toString())
      await rm(path.join(root, "bin/agent-desktop-macos-helper"))
      const missing = run()
      expect(missing.exitCode).not.toBe(0)
      expect(missing.stdout.toString()).toBe("")
      expect(missing.stderr.toString()).toContain("native files are missing")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
