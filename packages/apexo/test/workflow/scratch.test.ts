import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Workflow } from "@apexo/schema/workflow"
import { WorkflowScratch } from "@apexo/core/workflow/scratch"
import { tmpdir } from "../fixture/fixture"

test("workflow scratch isolates names and rejects symlink and hard-link targets", async () => {
  await using directory = await tmpdir()
  const id = Workflow.ID.make("workflow_scratchsecurity")
  const target = await WorkflowScratch.file(directory.path, id, "notes.txt", "private evidence")
  expect(await WorkflowScratch.file(directory.path, id, "notes.txt")).toBe("private evidence")
  await expect(WorkflowScratch.file(directory.path, id, "../outside", "changed")).rejects.toThrow(
    "Invalid workflow scratch",
  )
  const outside = path.join(directory.path, "outside.txt")
  await fs.writeFile(outside, "preserve")
  await fs.unlink(target)
  await fs.symlink(outside, target)
  await expect(WorkflowScratch.file(directory.path, id, "notes.txt", "changed")).rejects.toThrow()
  expect(await fs.readFile(outside, "utf8")).toBe("preserve")
  await fs.unlink(target)
  await fs.link(outside, target)
  await expect(WorkflowScratch.file(directory.path, id, "notes.txt", "changed")).rejects.toThrow(
    "Unsafe workflow scratch",
  )
  expect(await fs.readFile(outside, "utf8")).toBe("preserve")
})

test("workflow scratch rejects linked directories and oversized content", async () => {
  await using directory = await tmpdir()
  const id = Workflow.ID.make("workflow_scratchdirectory")
  const outside = path.join(directory.path, "outside")
  await fs.mkdir(outside)
  await fs.symlink(outside, path.join(directory.path, "workflow-scratch"))
  await expect(WorkflowScratch.file(directory.path, id, "notes.txt", "changed")).rejects.toThrow(
    "root cannot be a symlink",
  )
  expect(await fs.readdir(outside)).toEqual([])
  await expect(WorkflowScratch.file(directory.path, id, "notes.txt", "x".repeat(1_000_001))).rejects.toThrow(
    "Invalid workflow scratch",
  )
})

test("workflow scratch rejects aggregate bytes and file counts before changing files", async () => {
  await using directory = await tmpdir()
  const id = Workflow.ID.make("workflow_capacity")
  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      WorkflowScratch.file(directory.path, id, `${index}.txt`, "x".repeat(1_000_000)),
    ),
  )
  await expect(WorkflowScratch.file(directory.path, id, "overflow.txt", "extra")).rejects.toThrow("byte capacity")
  expect(await fs.readdir(path.join(directory.path, "workflow-scratch", id))).toHaveLength(16)
  await WorkflowScratch.file(directory.path, id, "0.txt", "short")
  expect(await WorkflowScratch.file(directory.path, id, "0.txt")).toBe("short")
  await WorkflowScratch.file(directory.path, id, "overflow.txt", "fits after replacement")
  for (const index of Array.from({ length: 47 }, (_, index) => index))
    await WorkflowScratch.file(directory.path, id, `empty${index}.txt`, "")
  await expect(WorkflowScratch.file(directory.path, id, "last.txt", "")).rejects.toThrow("file capacity")
  expect(await fs.readdir(path.join(directory.path, "workflow-scratch", id))).toHaveLength(64)
})
