import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { MemoryCatalog } from "@apexo/core/memory-catalog"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { MemorySession } from "@apexo/core/memory-session"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdir } from "../fixture/fixture"

test("catalog groups scopes, filters names and contents with all words, and preserves unrelated repositories", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, projectID: "catalog", permitted: () => true }
  await WorkspaceMemory.update(
    input.directory,
    { operation: "remember", content: "GLOBAL", scope: "global" },
    input.home,
  )
  await WorkspaceMemory.update(input.directory, { operation: "remember", content: "开发工具" }, input.home, input)
  await WorkspaceMemory.update(input.directory, { operation: "remember", content: "OTHER" }, input.home, {
    projectID: "other",
  })
  await MemorySession.save(
    input.directory,
    { sessionID: "ses_catalog", captured: 1, content: "SESSION" },
    input.home,
    input,
  )
  const notes = await MemoryCatalog.list(input)
  expect(notes.map((note) => note.source)).toEqual(["global", "workspace", "session"])
  expect((await MemoryCatalog.list(input, "memory 开发")).map((note) => note.source)).toEqual(["workspace"])
  expect(await MemoryCatalog.list(input, "开发 missing")).toEqual([])
  const note = await MemoryCatalog.preview(input, notes[1]!.path)
  expect(note.content).toContain("开发工具")
  expect(note.hash).toBe(
    createHash("sha256")
      .update(await readFile(note.path))
      .digest("hex"),
  )
  expect(note.truncated).toBe(false)
  expect(await MemoryCatalog.forget(input, { path: note.path, hash: note.hash! })).toBe(true)
  expect((await MemoryCatalog.list(input)).map((note) => note.source)).toEqual(["global", "session"])
  expect(await WorkspaceMemory.read(input.directory, input.home, { projectID: "other" })).toContain("OTHER")
})

test("forget rejects a changed preview and invalidates pre-delete automatic writes", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, permitted: () => true }
  await WorkspaceMemory.update(input.directory, { operation: "remember", content: "OLD" }, input.home)
  const location = WorkspaceMemory.maintenance(input.directory, input.home)
  const generation = await MemoryMaintenance.revision(location)
  const note = await MemoryCatalog.preview(input, WorkspaceMemory.file(input.directory, input.home))
  await writeFile(note.path, "NEW")
  await expect(MemoryCatalog.forget(input, { path: note.path, hash: note.hash! })).rejects.toMatchObject({
    reason: "changed",
  })
  expect(await readFile(note.path, "utf8")).toBe("NEW")
  expect(await MemoryMaintenance.revision(location)).toBe(generation)
  const current = await MemoryCatalog.preview(input, note.path)
  await MemoryCatalog.forget(input, { path: note.path, hash: current.hash! })
  expect(await MemoryMaintenance.revision(location)).not.toBe(generation)
  await expect(
    MemorySession.save(
      input.directory,
      { sessionID: "ses_old", captured: 1, content: "STALE", generation },
      input.home,
    ),
  ).rejects.toThrow("cleared")
  await expect(MemoryCatalog.preview(input, note.path)).rejects.toMatchObject({ reason: "not_found" })
})

test("browsing migrates legacy notes once and deleting them does not import them again", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, projectID: "migrated-catalog", permitted: () => true }
  await WorkspaceMemory.update(input.directory, { operation: "remember", content: "LEGACY_NOTE" }, input.home)
  const notes = await MemoryCatalog.list(input)
  expect(notes).toHaveLength(1)
  expect(notes[0]?.path).toBe(WorkspaceMemory.file(input.directory, input.home, input))
  const note = await MemoryCatalog.preview(input, notes[0]!.path)
  expect(note.content).toContain("LEGACY_NOTE")
  await MemoryCatalog.forget(input, { path: note.path, hash: note.hash! })
  expect(await MemoryCatalog.list(input)).toEqual([])
  expect(await readFile(WorkspaceMemory.file(input.directory, input.home), "utf8")).toContain("LEGACY_NOTE")
})

test("catalog hides denied reads, disables denied deletes, and checks canonical and alias permissions", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, permitted: () => true }
  await WorkspaceMemory.update(input.directory, { operation: "remember", content: "SECRET" }, input.home)
  const file = WorkspaceMemory.file(input.directory, input.home)
  const denied = { ...input, permitted: () => false }
  expect(await MemoryCatalog.list(denied)).toEqual([])
  await expect(MemoryCatalog.preview(denied, file)).rejects.toMatchObject({ reason: "forbidden" })
  const readonly = { ...input, permitted: (_paths: readonly string[], action: string) => action === "read" }
  const note = await MemoryCatalog.preview(readonly, file)
  expect(note.deletable).toBe(false)
  await expect(MemoryCatalog.forget(readonly, { path: file, hash: note.hash! })).rejects.toMatchObject({
    reason: "forbidden",
  })
  const alias = path.join(home.path, "home-alias")
  await symlink(home.path, alias)
  const aliased = { ...input, home: alias }
  const canonical = await MemoryCatalog.preview(aliased, file)
  expect(canonical.content).toContain("SECRET")
  expect(
    await MemoryCatalog.list({ ...aliased, permitted: (paths) => !paths.some((file) => file.startsWith(alias)) }),
  ).toEqual([])
  await MemoryCatalog.forget(aliased, { path: canonical.path, hash: canonical.hash! })
  expect(await MemoryCatalog.list(aliased)).toEqual([])
})

test("catalog rejects cross-repository paths and symlink targets without deleting the destination", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, projectID: "one", permitted: () => true }
  await WorkspaceMemory.update(input.directory, { operation: "remember", content: "OTHER" }, input.home, {
    projectID: "two",
  })
  const other = WorkspaceMemory.file(input.directory, input.home, { projectID: "two" })
  await expect(MemoryCatalog.preview(input, other)).rejects.toMatchObject({ reason: "forbidden" })
  const file = WorkspaceMemory.file(input.directory, input.home, input)
  await mkdir(path.dirname(file), { recursive: true })
  await symlink(other, file)
  expect(await MemoryCatalog.list(input)).toEqual([])
  await expect(MemoryCatalog.preview(input, file)).rejects.toThrow("symlinks")
  await expect(MemoryCatalog.forget(input, { path: file, hash: "a".repeat(64) })).rejects.toThrow("symlinks")
  expect(await readFile(other, "utf8")).toContain("OTHER")
})

test("preview caps bytes at 256 KiB, omits split UTF-8, and hashes original invalid UTF-8 bytes", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, permitted: () => true }
  const file = WorkspaceMemory.file(input.directory, input.home)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, "a".repeat(256 * 1024 - 1) + "中")
  const large = await MemoryCatalog.preview(input, file)
  expect(large.content).toBe("a".repeat(256 * 1024 - 1))
  expect(large.truncated).toBe(true)
  expect(large.deletable).toBe(false)
  expect(large.hash).toBeNull()
  await expect(MemoryCatalog.forget(input, { path: file, hash: "a".repeat(64) })).rejects.toMatchObject({
    reason: "changed",
  })
  await writeFile(file, Buffer.from([0xff]))
  const invalid = await MemoryCatalog.preview(input, file)
  await writeFile(file, Buffer.from([0xfe]))
  expect((await MemoryCatalog.preview(input, file)).content).toBe(invalid.content)
  await expect(MemoryCatalog.forget(input, { path: file, hash: invalid.hash! })).rejects.toMatchObject({
    reason: "changed",
  })
})

test("readers wait for a short mutation and abandoned mutation markers recover without clearing notes", async () => {
  await using home = await tmpdir()
  const input = WorkspaceMemory.maintenance(home.path, home.path)
  const started = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const changing = MemoryMaintenance.change(input, async () => async () => {
    started.resolve()
    await finish.promise
    await mkdir(input.root, { recursive: true })
    await writeFile(path.join(input.root, "MEMORY.md"), "PRESERVED")
  })
  await started.promise
  const reading = MemoryMaintenance.revision(input)
  finish.resolve()
  await changing
  expect(await reading).toBe(await MemoryMaintenance.revision(input))
  const markers = path.join(home.path, ".grok", "memory", ".cleared")
  const marker = path.join(markers, (await readdir(markers))[0]!)
  await writeFile(marker, JSON.stringify({ generation: "interrupted", pending: true, operation: "change" }))
  expect(await MemoryMaintenance.revision(input)).not.toBe("interrupted")
  expect(await readFile(path.join(input.root, "MEMORY.md"), "utf8")).toBe("PRESERVED")
})
