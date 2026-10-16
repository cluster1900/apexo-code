import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { PluginStore } from "@apexo/core/plugin-store"
import { tmpdir } from "../fixture/fixture"

const exec = promisify(execFile)

async function writePluginDir(dir: string, name: string) {
  await Bun.write(path.join(dir, "plugin.json"), JSON.stringify({ name, version: "1.0.0" }))
  await Bun.write(path.join(dir, "skills", "hello", "SKILL.md"), `---\nname: hello\ndescription: ${name}\n---\nHello`)
}

test("strict_known_marketplaces and extra_known_marketplaces enforce allowlisted sources with tighten-only precedence", async () => {
  await using tmp = await tmpdir()
  const store = path.join(tmp.path, "store")
  const allowedCatalog = path.join(tmp.path, "allowed-catalog")
  const extraCatalog = path.join(tmp.path, "extra-catalog")
  const rogueCatalog = path.join(tmp.path, "rogue-catalog")

  for (const [catalogDir, pluginName] of [
    [allowedCatalog, "allowed-plugin"],
    [extraCatalog, "extra-plugin"],
    [rogueCatalog, "rogue-plugin"],
  ] as const) {
    await writePluginDir(path.join(catalogDir, "plugins", pluginName), pluginName)
    await Bun.write(
      path.join(catalogDir, ".grok-plugin", "marketplace.json"),
      JSON.stringify({
        name: pluginName,
        plugins: [{ name: pluginName, source: `./plugins/${pluginName}`, description: pluginName, version: "1.0.0" }],
      }),
    )
  }

  // System requirements lock strict_known_marketplaces to [allowedCatalog]; user config adds extraCatalog and tries to disable strict mode
  await Bun.write(
    path.join(store, "requirements.toml"),
    [
      "[plugins]",
      `strict_known_marketplaces = [${JSON.stringify(allowedCatalog)}]`,
    ].join("\n"),
  )
  await Bun.write(
    path.join(store, "config.toml"),
    [
      "[plugins]",
      "strict_known_marketplaces = false",
      `extra_known_marketplaces = [${JSON.stringify(extraCatalog)}]`,
    ].join("\n"),
  )

  // Allowed and extra catalogs succeed
  const afterAllowed = await PluginStore.mutate(store, { action: "add-source", source: allowedCatalog })
  expect(afterAllowed.sources.some((s) => s.name === "allowed-plugin")).toBe(true)

  const afterExtra = await PluginStore.mutate(store, { action: "add-source", source: extraCatalog })
  expect(afterExtra.sources.some((s) => s.name === "extra-plugin")).toBe(true)

  // Rogue catalog and direct rogue plugin install are rejected
  await expect(PluginStore.mutate(store, { action: "add-source", source: rogueCatalog })).rejects.toThrow(
    "strict_known_marketplaces",
  )
  await expect(
    PluginStore.mutate(store, {
      action: "install",
      source: path.join(rogueCatalog, "plugins", "rogue-plugin"),
      trust: true,
    }),
  ).rejects.toThrow("strict_known_marketplaces")
})

test("tighten-only marketplace.require_sha rejects unpinned or mismatched refs and accepts verified 40-hex commit SHAs", async () => {
  await using tmp = await tmpdir()
  const store = path.join(tmp.path, "store")
  const repoDir = path.join(tmp.path, "plugin-repo")
  await writePluginDir(repoDir, "pinned-plugin")

  await exec("git", ["init", "-b", "main"], { cwd: repoDir })
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: repoDir })
  await exec("git", ["config", "user.name", "Test"], { cwd: repoDir })
  await exec("git", ["add", "."], { cwd: repoDir })
  await exec("git", ["commit", "--no-gpg-sign", "-m", "initial"], { cwd: repoDir })
  const commitSha = (await exec("git", ["rev-parse", "HEAD"], { cwd: repoDir })).stdout.trim()

  const catalogDir = path.join(tmp.path, "catalog")
  await Bun.write(
    path.join(catalogDir, ".grok-plugin", "marketplace.json"),
    JSON.stringify({
      name: "sha-catalog",
      plugins: [
        { name: "unpinned", source: "./plugins/unpinned", description: "Unpinned", version: "1.0.0" },
        {
          name: "pinned-plugin",
          source: { path: ".", sha: commitSha },
          description: "Pinned",
          version: "1.0.0",
        },
      ],
    }),
  )
  await writePluginDir(path.join(catalogDir, "plugins", "unpinned"), "unpinned")
  await writePluginDir(catalogDir, "pinned-plugin")
  await exec("git", ["init", "-b", "main"], { cwd: catalogDir })
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: catalogDir })
  await exec("git", ["config", "user.name", "Test"], { cwd: catalogDir })
  await exec("git", ["add", "."], { cwd: catalogDir })
  await exec("git", ["commit", "--no-gpg-sign", "-m", "catalog"], { cwd: catalogDir })
  const catalogSha = (await exec("git", ["rev-parse", "HEAD"], { cwd: catalogDir })).stdout.trim()

  // Update pinned-plugin entry to match catalogSha
  await Bun.write(
    path.join(catalogDir, ".grok-plugin", "marketplace.json"),
    JSON.stringify({
      name: "sha-catalog",
      plugins: [
        { name: "unpinned", source: "./plugins/unpinned", description: "Unpinned", version: "1.0.0" },
        {
          name: "pinned-plugin",
          source: { path: ".", sha: catalogSha },
          description: "Pinned",
          version: "1.0.0",
        },
      ],
    }),
  )

  // Enable require_sha in requirements.toml; attempt to set require_sha = false in config.toml
  await Bun.write(path.join(store, "requirements.toml"), "[marketplace]\nrequire_sha = true\n")
  await Bun.write(path.join(store, "config.toml"), "[marketplace]\nrequire_sha = false\n")

  const catalog = await PluginStore.mutate(store, { action: "add-source", source: catalogDir })
  const unpinnedItem = catalog.items.find((i) => i.name === "unpinned")!
  const pinnedItem = catalog.items.find((i) => i.name === "pinned-plugin")!

  await expect(PluginStore.mutate(store, { action: "install", id: unpinnedItem.id, trust: true })).rejects.toThrow(
    "require_sha",
  )

  const installed = await PluginStore.mutate(store, { action: "install", id: pinnedItem.id, trust: true })
  expect(installed.items.find((i) => i.id === pinnedItem.id)?.status).toBe("enabled")
})

test("organizational disabled_plugins and disable_plugins block activation while preserving in-flight captured readers", async () => {
  await using tmp = await tmpdir()
  const store = path.join(tmp.path, "store")
  const alphaDir = path.join(tmp.path, "alpha")
  const betaDir = path.join(tmp.path, "beta")
  await writePluginDir(alphaDir, "alpha")
  await writePluginDir(betaDir, "beta")

  await PluginStore.mutate(store, { action: "install", source: alphaDir, trust: true })
  await PluginStore.mutate(store, { action: "install", source: betaDir, trust: true })
  expect((await PluginStore.active(store)).map((p) => p.item.name).sort()).toEqual(["alpha", "beta"])

  // Capture an in-flight lease before policy change
  const inFlight = await PluginStore.capture(store)
  expect(inFlight.plugins.map((p) => p.item.name).sort()).toEqual(["alpha", "beta"])

  // Organization disables "alpha" via requirements.toml; user config tries to clear disabled list
  await Bun.write(path.join(store, "requirements.toml"), '[plugins]\ndisabled = ["alpha"]\n')
  await Bun.write(path.join(store, "config.toml"), "[plugins]\ndisabled = []\n")

  // Active list and new captures exclude "alpha"
  expect((await PluginStore.active(store)).map((p) => p.item.name)).toEqual(["beta"])
  const nextCapture = await PluginStore.capture(store)
  expect(nextCapture.plugins.map((p) => p.item.name)).toEqual(["beta"])
  await nextCapture.release()

  // Attempting to explicitly enable "alpha" fails due to policy
  await expect(PluginStore.mutate(store, { action: "enable", id: "alpha", trust: true })).rejects.toThrow("policy")

  // In-flight captured reader still has its alpha data directory intact until release
  const alphaInFlight = inFlight.plugins.find((p) => p.item.name === "alpha")!
  expect(await Bun.file(path.join(alphaInFlight.root, "plugin.json")).exists()).toBe(true)
  await inFlight.release()

  // Setting disable_plugins = true disables all remaining plugins
  await Bun.write(path.join(store, "requirements.toml"), "[plugins]\ndisable_plugins = true\n")
  expect(await PluginStore.active(store)).toEqual([])
})
