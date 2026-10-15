import { expect, test } from "bun:test"
import { mkdir, readFile, readdir, symlink, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { MemoryDream } from "@apexo/core/memory-dream"
import { tmpdir } from "../fixture/fixture"

test("dream response requires useful Markdown and truncates by Unicode character", () => {
  expect(MemoryDream.response("**No-Reply**").status).toBe("empty")
  expect(MemoryDream.response("Unstructured output").status).toBe("rejected")
  const result = MemoryDream.response(`## Decisions\n${"😀".repeat(16_000)}`)
  expect(result.status).toBe("accepted")
  if (result.status !== "accepted") throw new Error("Expected accepted memory")
  expect(Array.from(result.content)).toHaveLength(16_000)
  expect(result.content).not.toContain("�")
})

test("dream input preserves full admitted logs and leaves files beyond the input cap unprocessed", () => {
  const item = (file: string, content: string): MemoryDream.Snapshot => ({
    path: file,
    content,
    signature: file,
    modified: 0,
  })
  const existing = item("MEMORY.md", `## 旧记忆\n${"😀".repeat(8000)}`)
  const result = MemoryDream.message(existing, [item("first.md", "a".repeat(32_000)), item("second.md", "UNREAD")])
  expect(result.processed.map((item) => item.path)).toEqual(["first.md"])
  expect(result.content).not.toContain("�")
  expect(result.content).not.toContain("UNREAD")
  expect(result.content).toContain("a".repeat(32_000))
  expect(
    MemoryDream.message(item("MEMORY.md", "Add project-specific knowledge here"), [item("one.md", "## Lesson")])
      .content,
  ).not.toContain("Add project-specific")
})

test("successful consolidation writes Markdown and cleans only old unchanged processed logs", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, projectID: "dream-tests" }
  const files = MemoryDream.paths(input)
  await mkdir(files.sessions, { recursive: true })
  await writeFile(files.file, "## Prior decision\nRetain this knowledge.\n")
  await Promise.all(
    ["old", "changed", "recent", "unread"].map(async (name) => {
      const target = path.join(files.sessions, `${name}.md`)
      await writeFile(target, `## ${name}\nKnowledge`)
      if (name !== "recent") await utimes(target, new Date(1), new Date(1))
    }),
  )
  const existing = await MemoryDream.snapshot(files.file, input)
  const processed = (
    await Promise.all(
      ["old", "changed", "recent"].map((name) => MemoryDream.snapshot(path.join(files.sessions, `${name}.md`), input)),
    )
  ).filter((value) => value !== undefined)
  await writeFile(path.join(files.sessions, "changed.md"), "## Concurrent flush\nNew evidence")
  const result = await MemoryDream.commit(input, {
    existing,
    previous: MemoryDream.state(),
    processed,
    content: "## Decisions\nMerged knowledge",
    now: Date.now(),
  })
  expect(result).toMatchObject({ status: "completed", processed: 3, cleaned: 1 })
  expect(await readFile(files.file, "utf8")).toBe("## Decisions\nMerged knowledge\n")
  expect((await readdir(files.sessions)).sort()).toEqual(["changed.md", "recent.md", "unread.md"])
  const state = MemoryDream.state(await MemoryDream.snapshot(files.state, input))
  expect(state.processed["unread.md"]).toBeUndefined()
  expect(state.processed["changed.md"]).not.toBe(
    (await MemoryDream.snapshot(path.join(files.sessions, "changed.md"), input))?.signature,
  )
})

test("concurrent edits to long-term memory prevent stale replacement and session cleanup", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path }
  const files = MemoryDream.paths(input)
  await mkdir(files.sessions, { recursive: true })
  await writeFile(files.file, "## Before")
  const existing = await MemoryDream.snapshot(files.file, input)
  await writeFile(files.file, "## User correction\nKeep this newer decision")
  expect(
    await MemoryDream.commit(input, {
      existing,
      previous: MemoryDream.state(),
      processed: [],
      content: "## Stale",
      now: Date.now(),
    }),
  ).toEqual({ status: "conflict" })
  expect(await readFile(files.file, "utf8")).toContain("User correction")
  expect(await MemoryDream.snapshot(files.state, input)).toBeUndefined()
})

test("NO_REPLY records consumed versions without rewriting memory or deleting logs", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path }
  const files = MemoryDream.paths(input)
  await mkdir(files.sessions, { recursive: true })
  const target = path.join(files.sessions, "one.md")
  await writeFile(target, "## Session Summary\nNo reusable information")
  const record = await MemoryDream.snapshot(target, input)
  if (!record) throw new Error("Missing fixture")
  expect(
    await MemoryDream.commit(input, { previous: MemoryDream.state(), processed: [record], now: 123 }),
  ).toMatchObject({ status: "no_work", cleaned: 0 })
  expect(await MemoryDream.snapshot(files.file, input)).toBeUndefined()
  expect((await MemoryDream.snapshot(target, input))?.content).toBe(record.content)
  expect(MemoryDream.state(await MemoryDream.snapshot(files.state, input)).completed).toBe(123)
})

test("dream excludes current session, links and non-Markdown input; rejects redirected writes", async () => {
  await using home = await tmpdir()
  await using outside = await tmpdir()
  const input = { directory: home.path, home: home.path }
  const files = MemoryDream.paths(input)
  await mkdir(files.sessions, { recursive: true })
  await Promise.all(
    ["2026-10-13-ses_current.md", "2026-10-13-ses_current-flush.md", "another.md", "index.sqlite"].map((name) =>
      writeFile(path.join(files.sessions, name), "## Facts"),
    ),
  )
  await writeFile(path.join(outside.path, "secret.md"), "PRIVATE")
  await symlink(path.join(outside.path, "secret.md"), path.join(files.sessions, "linked.md"))
  expect(await MemoryDream.files(input, "ses_current")).toEqual([path.join(files.sessions, "another.md")])
  await symlink(path.join(outside.path, "secret.md"), files.file)
  expect(MemoryDream.snapshot(files.file, input)).rejects.toThrow("redirected")
  expect(
    MemoryDream.commit(input, { previous: MemoryDream.state(), processed: [], content: "## Overwrite", now: 123 }),
  ).rejects.toThrow("redirected")
  expect(await readFile(path.join(outside.path, "secret.md"), "utf8")).toBe("PRIVATE")
})

test("invalid dream journal is not silently discarded", () => {
  expect(() => MemoryDream.state({ path: "state", content: "broken", signature: "", modified: 0 })).toThrow(
    "Invalid dream state",
  )
})

test("existing knowledge omitted by the model input cap survives consolidation", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path }
  const files = MemoryDream.paths(input)
  await mkdir(files.root, { recursive: true })
  await writeFile(files.file, `## Prior knowledge\n${"😀".repeat(8000)}\nUNSEEN_FACT_MUST_SURVIVE`)
  const existing = await MemoryDream.snapshot(files.file, input)
  expect(MemoryDream.message(existing, []).content).not.toContain("UNSEEN_FACT_MUST_SURVIVE")
  await MemoryDream.commit(input, {
    existing,
    previous: MemoryDream.state(),
    processed: [],
    content: "## Merged visible knowledge",
    now: Date.now(),
  })
  const saved = await readFile(files.file, "utf8")
  expect(saved).toContain("Merged visible knowledge")
  expect(saved).toContain("UNSEEN_FACT_MUST_SURVIVE")
  expect(saved).not.toContain("�")
})

test("native publication resumes exact partial bytes and rejects foreign state without overwrite", async () => {
  await using home = await tmpdir()
  const input = { directory: home.path, home: home.path, projectID: "native-dream-publication" }
  const files = MemoryDream.paths(input)
  await mkdir(files.root, { recursive: true })
  await writeFile(files.file, "## Original\nRetained fact")
  const existing = await MemoryDream.snapshot(files.file, input, 1000)
  const publication = { existing, memory: "## New\nRecorded output", journal: '{"completed":1,"processed":{}}' }
  await writeFile(files.file, publication.memory)
  await MemoryDream.publish(input, publication)
  expect(await readFile(files.state, "utf8")).toBe(publication.journal)
  await MemoryDream.publish(input, publication)
  await writeFile(files.state, "foreign state")
  await expect(MemoryDream.publish(input, publication)).rejects.toThrow("Dream state changed")
  expect(await readFile(files.state, "utf8")).toBe("foreign state")
  expect(await readFile(files.file, "utf8")).toBe(publication.memory)
  await expect(MemoryDream.snapshot(files.file, input, 2)).rejects.toThrow("exceeds its bound")
})
