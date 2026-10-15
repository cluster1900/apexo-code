import { expect, test } from "bun:test"
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { MemorySession } from "@apexo/core/memory-session"
import { MemoryDream } from "@apexo/core/memory-dream"
import { tmpdir } from "../fixture/fixture"

test("workspace clear removes its complete store, preserves other scopes and suppresses legacy migration", async () => {
  await using home = await tmpdir()
  const location = { projectID: "clear-project" }
  const input = WorkspaceMemory.maintenance(home.path, home.path, location)
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "LEGACY" }, home.path)
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "CURRENT" }, home.path, location)
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "GLOBAL", scope: "global" }, home.path)
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "OTHER" }, home.path, {
    projectID: "other",
  })
  await mkdir(path.join(input.root, "sessions"))
  await writeFile(path.join(input.root, "sessions", "session.md"), "OLD_SESSION")
  await writeFile(path.join(input.root, "search.sqlite"), "OLD_INDEX")
  expect(await MemoryMaintenance.clear(input, "workspace")).toBe(true)
  expect(await MemoryMaintenance.targets(input, "workspace")).toEqual([])
  expect(await WorkspaceMemory.read(home.path, home.path, location)).toBe("")
  expect(await WorkspaceMemory.read(home.path, home.path, { scope: "global" })).toContain("GLOBAL")
  expect(await WorkspaceMemory.read(home.path, home.path, { projectID: "other" })).toContain("OTHER")
  expect(await readFile(WorkspaceMemory.file(home.path, home.path), "utf8")).toContain("LEGACY")
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "FRESH" }, home.path, location)
  expect(await WorkspaceMemory.read(home.path, home.path, location)).toContain("FRESH")
  expect(await WorkspaceMemory.read(home.path, home.path, location)).not.toContain("LEGACY")
})

test("global clear covers readable global notes without removing workspace stores", async () => {
  await using home = await tmpdir()
  const input = WorkspaceMemory.maintenance(home.path, home.path, { scope: "global" })
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "GLOBAL", scope: "global" }, home.path)
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "WORKSPACE" }, home.path)
  await mkdir(path.join(input.root, "topics"))
  await writeFile(path.join(input.root, "topics", "preferences.md"), "PREFERENCES")
  expect(await MemoryMaintenance.clear(input, "global")).toBe(true)
  expect(await WorkspaceMemory.read(home.path, home.path, { scope: "global" })).toBe("")
  expect(await WorkspaceMemory.read(home.path, home.path)).toContain("WORKSPACE")
  expect(await MemoryMaintenance.targets(input, "global")).toEqual([])
  expect(await MemoryMaintenance.clear(input, "global")).toBe(false)
})

test("clear rejects old checkpoint, flush and dream writes even when no prior MEMORY.md existed", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, projectID: "clear-inflight" }
  const location = WorkspaceMemory.maintenance(input.directory, input.home, input)
  const generation = await MemoryMaintenance.revision(location)
  const record = { sessionID: "ses_flush", captured: Date.now(), content: "## OLD", generation }
  await MemorySession.save(input.directory, record, input.home, input)
  const files = MemoryDream.paths(input)
  const processed = [
    await MemoryDream.snapshot(MemorySession.file(input.directory, record, input.home, input), input),
  ].filter((value) => value !== undefined)
  await MemoryMaintenance.clear(location, "workspace")
  await expect(MemorySession.save(input.directory, record, input.home, input)).rejects.toThrow("cleared")
  await expect(
    MemoryDream.commit(input, {
      generation,
      previous: MemoryDream.state(),
      processed,
      content: "## STALE",
      now: Date.now(),
    }),
  ).rejects.toThrow("cleared")
  expect(await MemoryDream.snapshot(files.file, input)).toBeUndefined()
  await MemorySession.save(
    input.directory,
    { ...record, generation: await MemoryMaintenance.revision(location), content: "## NEW" },
    input.home,
    input,
  )
  expect(await MemorySession.load(input.directory, record, input.home, input)).toBe("## NEW")
})

test("clear serializes with a real in-flight storage write", async () => {
  await using home = await tmpdir()
  const input = WorkspaceMemory.maintenance(home.path, home.path)
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const order: string[] = []
  const writer = MemoryMaintenance.write(input, async () => {
    started.resolve()
    await release.promise
    await mkdir(input.root, { recursive: true })
    await writeFile(path.join(input.root, "MEMORY.md"), "IN_FLIGHT")
    order.push("write")
  })
  await started.promise
  const clearing = MemoryMaintenance.clear(input, "workspace").then(() => order.push("clear"))
  release.resolve()
  await Promise.all([writer, clearing])
  expect(order).toEqual(["write", "clear"])
  expect(await WorkspaceMemory.read(home.path, home.path)).toBe("")
})

test("clear refuses redirected roots and control directories and does not follow nested links", async () => {
  await using home = await tmpdir()
  await using outside = await tmpdir()
  const input = WorkspaceMemory.maintenance(home.path, home.path)
  await writeFile(path.join(outside.path, "keep.md"), "KEEP")
  await mkdir(path.dirname(input.root), { recursive: true })
  await symlink(outside.path, input.root)
  await expect(MemoryMaintenance.clear(input, "workspace")).rejects.toThrow("symbolic")
  await rm(input.root)
  await mkdir(input.root)
  await symlink(outside.path, path.join(input.root, "topics"))
  await MemoryMaintenance.clear(input, "workspace")
  expect(await readFile(path.join(outside.path, "keep.md"), "utf8")).toBe("KEEP")
  await rm(path.join(home.path, ".grok", "memory", ".cleared"), { recursive: true })
  await symlink(outside.path, path.join(home.path, ".grok", "memory", ".cleared"))
  await expect(MemoryMaintenance.clear(input, "workspace")).rejects.toThrow("symbolic")
  expect(await readdir(outside.path)).toEqual(["keep.md"])
})

test("an interrupted clear fails closed and can be finished after the target disappeared", async () => {
  await using home = await tmpdir()
  const input = WorkspaceMemory.maintenance(home.path, home.path)
  await WorkspaceMemory.update(home.path, { operation: "remember", content: "OLD" }, home.path)
  await MemoryMaintenance.clear(input, "workspace")
  const markers = path.join(home.path, ".grok", "memory", ".cleared")
  const marker = path.join(markers, (await readdir(markers))[0]!)
  await writeFile(marker, JSON.stringify({ generation: "interrupted", pending: true }))
  await expect(WorkspaceMemory.read(home.path, home.path)).rejects.toThrow("incomplete")
  expect(await MemoryMaintenance.targets(input, "workspace")).toEqual([input.root])
  expect(await MemoryMaintenance.clear(input, "workspace")).toBe(true)
  expect(await WorkspaceMemory.read(home.path, home.path)).toBe("")
  await writeFile(marker, "corrupt")
  await expect(MemoryMaintenance.revision(input)).rejects.toThrow("Invalid")
  await writeFile(marker, JSON.stringify({ generation: "../../escape", pending: false }))
  await expect(MemoryMaintenance.revision(input)).rejects.toThrow("Invalid")
})
