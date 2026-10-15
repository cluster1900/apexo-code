import { expect, test } from "bun:test"
import { mkdir, readFile, symlink } from "node:fs/promises"
import path from "node:path"
import { MemoryReview } from "@apexo/core/memory-review"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdir } from "../fixture/fixture"

test("reviewed notes preserve Markdown, default to global, and serialize concurrent saves", async () => {
  await using temp = await tmpdir()
  const input = { directory: temp.path, home: temp.path, projectID: "review", permitted: () => true }
  const global = await MemoryReview.save(input, { content: "  ## Preferences\r\nUse concise replies.  " })
  expect(global.path).toBe(WorkspaceMemory.file(temp.path, temp.path, { scope: "global" }))
  expect(await readFile(global.path, "utf8")).toBe("## Preferences\nUse concise replies.\n")
  await Promise.all(["FIRST", "SECOND"].map((content) => MemoryReview.save(input, { content })))
  const text = await readFile(global.path, "utf8")
  expect(text).toContain("FIRST")
  expect(text).toContain("SECOND")
  const workspace = await MemoryReview.save(input, { content: "PROJECT_ONLY", scope: "workspace" })
  expect(workspace.path).not.toBe(global.path)
  expect(await readFile(workspace.path, "utf8")).toBe("PROJECT_ONLY\n")
  expect(await readFile(global.path, "utf8")).not.toContain("PROJECT_ONLY")
})

test("review saves reject empty/oversized UTF-8 notes, denied access, and redirected files", async () => {
  await using temp = await tmpdir()
  const input = { directory: temp.path, home: temp.path, permitted: () => true }
  for (const content of ["   ", "界".repeat(11000)])
    await expect(MemoryReview.save(input, { content })).rejects.toMatchObject({ reason: "invalid" })
  await expect(MemoryReview.save({ ...input, permitted: () => false }, { content: "DENIED" })).rejects.toMatchObject({
    reason: "forbidden",
  })
  const workspace = await MemoryReview.save(input, { content: "PRESERVED", scope: "workspace" })
  await symlink(workspace.path, WorkspaceMemory.file(temp.path, temp.path, { scope: "global" }))
  await expect(MemoryReview.save(input, { content: "ESCAPE" })).rejects.toThrow()
  expect(await readFile(workspace.path, "utf8")).toBe("PRESERVED\n")
})

test("review saves check both canonical and displayed home paths", async () => {
  await using temp = await tmpdir()
  const home = path.join(temp.path, "home")
  const alias = path.join(temp.path, "alias")
  await mkdir(home)
  await symlink(home, alias)
  const input = {
    directory: temp.path,
    home: alias,
    permitted: (paths: readonly string[]) => !paths.some((p) => p.startsWith(home)),
  }
  await expect(MemoryReview.save(input, { content: "DENIED" })).rejects.toMatchObject({ reason: "forbidden" })
})
