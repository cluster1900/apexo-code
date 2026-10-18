import { describe, expect, test } from "bun:test"
import path from "node:path"
import { $ } from "bun"
import { PluginStore } from "@apexo/core/plugin-store"
import { tmpdir } from "../fixture/fixture"

const skill = (description = "Example skill") => `---\nname: example\ndescription: ${description}\n---\nBody\n`

async function plugin(dir: string, manifest: Record<string, unknown> = { name: "example", version: "1.2.0" }) {
  await Bun.write(path.join(dir, "plugin.json"), JSON.stringify(manifest))
  await Bun.write(path.join(dir, "skills", "example", "SKILL.md"), skill())
}

async function cli(cwd: string, ...args: string[]) {
  const proc = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../../src/index.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, APEXO_DISABLE_AUTOUPDATE: "1" },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

describe("plugin validate", () => {
  test("accepts a well-formed plugin", async () => {
    await using tmp = await tmpdir()
    await plugin(tmp.path)
    const result = await PluginStore.validate(tmp.path)
    expect(result).toMatchObject({ kind: "plugin", name: "example", version: "1.2.0", errors: [] })
  })

  test("reports broken JSON, non-semver versions and empty plugins", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "plugin.json"), JSON.stringify({ name: "x", version: "one" }))
    await Bun.write(path.join(tmp.path, ".mcp.json"), "{ nope")
    const result = await PluginStore.validate(tmp.path)
    expect(result.errors.some((e) => e.includes("not semver"))).toBe(true)
    expect(result.errors.some((e) => e.startsWith(".mcp.json:"))).toBe(true)
    await using empty = await tmpdir()
    await Bun.write(path.join(empty.path, "plugin.json"), JSON.stringify({ name: "empty", version: "1.0.0" }))
    expect((await PluginStore.validate(empty.path)).errors).toEqual(["No supported plugin components found"])
  })

  test("checks every marketplace entry", async () => {
    await using tmp = await tmpdir()
    await plugin(path.join(tmp.path, "plugins", "good"), { name: "good", version: "1.0.0" })
    await Bun.write(
      path.join(tmp.path, ".grok-plugin", "marketplace.json"),
      JSON.stringify({
        name: "Org",
        plugins: [
          { name: "good", description: "ok", source: { type: "local", path: "./plugins/good" } },
          { name: "good", source: "./plugins/good" },
          { name: "remote", description: "r", source: { source: "url", url: "https://example.com/r.git" } },
          { name: "badsha", description: "r", source: { source: "url", url: "https://example.com/r.git", sha: "abc" } },
          { name: "escape", description: "e", source: "../outside" },
        ],
      }),
    )
    const result = await PluginStore.validate(tmp.path)
    expect(result.kind).toBe("marketplace")
    expect(result.errors).toEqual([
      "good: duplicate plugin name",
      'badsha: "sha" must be a full 40-character commit sha',
      "escape: source path ../outside escapes the repository",
    ])
    expect(result.warnings).toContain('remote: url source has no pinned "sha"; installs are not reproducible')
    expect(result.plugins.every((item) => item.errors.length === 0)).toBe(true)
  })

  test("CLI exits non-zero on errors and zero when valid", async () => {
    await using tmp = await tmpdir()
    await plugin(path.join(tmp.path, "ok"))
    await Bun.write(path.join(tmp.path, "bad", "plugin.json"), "{")
    const ok = await cli(tmp.path, "plugin", "validate", "ok")
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain("Valid.")
    const bad = await cli(tmp.path, "plugins", "validate", "bad")
    expect(bad.code).not.toBe(0)
    expect(bad.stdout + bad.stderr).toContain("plugin.json:")
  }, 60_000)
})

describe("plugin tag", () => {
  test("tags from the manifest version and pushes on request", async () => {
    await using tmp = await tmpdir()
    const remote = path.join(tmp.path, "remote.git")
    const repo = path.join(tmp.path, "repo")
    await $`git init -q --bare ${remote}`.quiet()
    await plugin(repo)
    await plugin(path.join(repo, "plugins", "nested"), { name: "nested", version: "0.3.1" })
    await $`git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git remote add origin ${remote}`
      .cwd(repo)
      .quiet()
    const env = { GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
    Object.assign(process.env, env)
    expect(await PluginStore.tag(repo)).toMatchObject({ tag: "v1.2.0", pushed: false })
    await expect(PluginStore.tag(repo)).rejects.toThrow("tag v1.2.0 already exists")
    const pushed = await cli(repo, "plugin", "tag", "plugins/nested", "--push")
    expect(pushed.stdout).toContain("Tagged nested-v0.3.1 and pushed it to origin.")
    expect((await $`git tag --list`.cwd(remote).text()).trim().split("\n")).toEqual(["nested-v0.3.1"])
    await expect(PluginStore.tag(path.join(tmp.path, "nope"))).rejects.toThrow("is not a directory")
  }, 60_000)
})
