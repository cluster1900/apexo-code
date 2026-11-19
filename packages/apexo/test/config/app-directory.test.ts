import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { chmod, lstat, mkdir, realpath, rename, symlink } from "node:fs/promises"
import path from "node:path"
import { migrateAppDirectory, migratedWorktreePaths } from "@apexo/core/app-directory"
import { tmpdir } from "../fixture/fixture"

test("CLI processes share the migrated XDG directories and can open the existing database", async () => {
  await using tmp = await tmpdir()
  const env = { ...process.env }
  delete env.APEXO_APP_DIR_NAME
  delete env.OPENCODE_APP_DIR_NAME
  delete env.APEXO_DB
  env.APEXO_DISABLE_CHANNEL_DB = "1"
  env.XDG_DATA_HOME = path.join(tmp.path, "data")
  env.XDG_CONFIG_HOME = path.join(tmp.path, "config")
  env.XDG_CACHE_HOME = path.join(tmp.path, "cache")
  env.XDG_STATE_HOME = path.join(tmp.path, "state")
  const roots = {
    data: env.XDG_DATA_HOME,
    config: env.XDG_CONFIG_HOME,
    cache: env.XDG_CACHE_HOME,
    state: env.XDG_STATE_HOME,
  }
  for (const [type, root] of Object.entries(roots)) {
    await Bun.write(path.join(root, "opencode", "fixture.txt"), type)
  }
  await mkdir(path.join(roots.state, "apexo"))
  const legacyDB = path.join(roots.data, "opencode", "opencode.db")
  const db = new Database(legacyDB, { create: true })
  db.exec("CREATE TABLE fixture (message TEXT); INSERT INTO fixture VALUES ('existing session')")
  db.close()

  const inspectPaths = async () => {
    const global = JSON.stringify(import.meta.resolve("@apexo/core/global"))
    const database = JSON.stringify(import.meta.resolve("@apexo/core/database/database"))
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `const { Global } = await import(${global}); const { Database } = await import(${database});
         console.log(JSON.stringify({ ...Global.Path, database: Database.path() }));`,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exit, stderr).toBe(0)
    return JSON.parse(stdout) as Record<string, string>
  }

  const results = await Promise.all([inspectPaths(), inspectPaths()])
  expect(results[0]).toEqual(results[1])
  for (const [type, root] of Object.entries(roots)) {
    const current = path.join(root, "apexo")
    const previous = path.join(root, "opencode")
    expect(results[0][type]).toBe(current)
    expect((await lstat(current)).isDirectory()).toBe(true)
    expect((await lstat(previous)).isSymbolicLink()).toBe(true)
    expect(await realpath(previous)).toBe(await realpath(current))
    expect(await Bun.file(path.join(current, "fixture.txt")).text()).toBe(type)
  }
  const existing = new Database(results[0].database, { readonly: true })
  try {
    expect(results[0].database).toBe(path.join(roots.data, "apexo", "opencode.db"))
    expect(existing.query("SELECT message FROM fixture").get()).toEqual({ message: "existing session" })
  } finally {
    existing.close()
  }

  await Bun.write(path.join(roots.data, "custom", "profile.txt"), "custom profile")
  env.APEXO_APP_DIR_NAME = "custom"
  expect((await inspectPaths()).data).toBe(path.join(roots.data, "custom"))
})

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "the CLI loads readable legacy config when its parent is read-only, then migrates it once writable",
  async () => {
    await using tmp = await tmpdir()
    const parent = path.join(tmp.path, "config")
    const legacy = path.join(parent, "opencode")
    const current = path.join(parent, "apexo")
    await Bun.write(path.join(legacy, "opencode.json"), JSON.stringify({ username: "legacy-readonly-config" }))
    const debug = async (command: string) => {
      const child = Bun.spawn(
        [process.execPath, "run", path.join(import.meta.dir, "../../src/index.ts"), "debug", command],
        {
          cwd: tmp.path,
          env: {
            PATH: process.env.PATH,
            HOME: tmp.path,
            TMPDIR: tmp.path,
            APEXO_TEST_HOME: tmp.path,
            APEXO_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, "managed"),
            APEXO_DISABLE_MODELS_FETCH: "1",
            APEXO_DISABLE_PROJECT_CONFIG: "1",
            APEXO_PURE: "1",
            APEXO_DB: ":memory:",
            XDG_DATA_HOME: path.join(tmp.path, "data"),
            XDG_CONFIG_HOME: parent,
            XDG_CACHE_HOME: path.join(tmp.path, "cache"),
            XDG_STATE_HOME: path.join(tmp.path, "state"),
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: 15_000,
        },
      )
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(exit, stderr).toBe(0)
      return stdout
    }

    await chmod(parent, 0o555)
    try {
      expect(await debug("paths")).toContain(`config     ${legacy}`)
      expect(JSON.parse(await debug("config")).username).toBe("legacy-readonly-config")
      expect((await lstat(legacy)).isDirectory()).toBe(true)
      expect(await lstat(current).catch(() => undefined)).toBeUndefined()
    } finally {
      await chmod(parent, 0o755)
    }

    expect(await debug("paths")).toContain(`config     ${current}`)
    expect((await lstat(legacy)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await debug("config")).username).toBe("legacy-readonly-config")

    const staged = path.join(parent, ".apexo.directory-migration")
    await rename(legacy, staged)
    await chmod(parent, 0o555)
    try {
      expect(await debug("paths")).toContain(`config     ${current}`)
      expect((await lstat(staged)).isSymbolicLink()).toBe(true)
    } finally {
      await chmod(parent, 0o755)
    }
    expect(await debug("paths")).toContain(`config     ${current}`)
    expect(await realpath(legacy)).toBe(await realpath(current))
  },
  60_000,
)

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "migration falls back to the readable source when publishing fails beside an empty destination",
  async () => {
    await using tmp = await tmpdir()
    const legacy = path.join(tmp.path, "opencode")
    const current = path.join(tmp.path, "apexo")
    await Bun.write(path.join(legacy, "state"), "legacy")
    await mkdir(current)
    await mkdir(path.join(tmp.path, ".apexo-migration-locks"))
    await chmod(tmp.path, 0o555)
    try {
      expect(await migrateAppDirectory(tmp.path, "apexo", "opencode")).toBe(legacy)
      expect(await Bun.file(path.join(legacy, "state")).text()).toBe("legacy")
      await chmod(legacy, 0o000)
      await expect(migrateAppDirectory(tmp.path, "apexo", "opencode")).rejects.toMatchObject({ code: "EACCES" })
    } finally {
      await chmod(legacy, 0o755)
      await chmod(tmp.path, 0o755)
    }
    expect(await migrateAppDirectory(tmp.path, "apexo", "opencode")).toBe(current)
    expect(await Bun.file(path.join(current, "state")).text()).toBe("legacy")
  },
)

test("directory migration keeps an existing Apexo directory and can finish an interrupted move", async () => {
  await using tmp = await tmpdir()
  const next = path.join(tmp.path, "apexo")
  const previous = path.join(tmp.path, "opencode")
  await Bun.write(path.join(next, "state"), "current")
  await Bun.write(path.join(previous, "state"), "legacy")
  expect(await migrateAppDirectory(tmp.path, "apexo", "opencode")).toBe(next)
  expect(await Bun.file(path.join(next, "state")).text()).toBe("current")
  expect(await Bun.file(path.join(previous, "state")).text()).toBe("legacy")
  expect((await lstat(previous)).isSymbolicLink()).toBe(false)

  const base = path.join(tmp.path, "desktop")
  await mkdir(base)
  const oldProfile = path.join(base, "ai.opencode.desktop")
  const profile = path.join(base, "com.apexolab.desktop")
  const staged = path.join(base, ".com.apexolab.desktop.directory-migration")
  await Bun.write(path.join(oldProfile, "settings"), "preserved")
  await symlink(profile, staged, process.platform === "win32" ? "junction" : "dir")
  await rename(oldProfile, profile)
  expect(await migrateAppDirectory(base, "com.apexolab.desktop", "ai.opencode.desktop")).toBe(profile)
  expect(await realpath(oldProfile)).toBe(await realpath(profile))
  expect(await Bun.file(path.join(profile, "settings")).text()).toBe("preserved")
  expect(await lstat(staged).catch(() => undefined)).toBeUndefined()
})

test("only the worktrees of a shared Apexo data directory use both path spellings", async () => {
  await using tmp = await tmpdir()
  const legacy = path.join(tmp.path, "opencode", "worktree", "copy")
  const data = path.join(tmp.path, "apexo")
  const current = path.join(data, "worktree", "copy")
  await mkdir(legacy, { recursive: true })
  expect(migratedWorktreePaths(data, current)).toEqual([current])

  await migrateAppDirectory(tmp.path, "apexo", "opencode")
  expect(migratedWorktreePaths(data, current)).toEqual([current, legacy])
  expect(migratedWorktreePaths(data, legacy)).toEqual([legacy, current])
  const config = path.join(tmp.path, "opencode", "settings")
  expect(migratedWorktreePaths(data, config)).toEqual([config])
  const other = path.join(tmp.path, "separate", "apexo", "worktree", "copy")
  expect(migratedWorktreePaths(data, other)).toEqual([other])
})
