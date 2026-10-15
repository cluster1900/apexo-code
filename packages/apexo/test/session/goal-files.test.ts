import { expect, test } from "bun:test"
import { chmod, link, lstat, mkdir, rename, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { SessionGoalFiles } from "@apexo/core/session/goal-files"
import { tmpdir } from "../fixture/fixture"

test("Goal plans and verifier reports persist exact bytes, hashes and separate private paths", async () => {
  await using tmp = await tmpdir()
  const planner = await SessionGoalFiles.create({
    data: tmp.path,
    kind: "planning",
    objective: "完整目标 😀",
    evidence: "{}",
  })
  await planner.write(planner.paths.plan, "# Plan\nVerify the full objective 中文")
  const planned = await planner.finish()
  expect(JSON.parse(planned.text).plan).toContain("中文")
  expect((await SessionGoalFiles.read(planned.files.objective.path)).text).toBe("完整目标 😀")
  expect((await SessionGoalFiles.read(planned.files.plan.path)).file).toEqual(planned.files.plan)
  if (process.platform !== "win32") {
    expect((await lstat(planned.files.directory)).mode & 0o777).toBe(0o700)
    expect((await lstat(planned.files.plan.path)).mode & 0o777).toBe(0o600)
  }
  const verifier = await SessionGoalFiles.create({
    data: tmp.path,
    kind: "verifying",
    objective: "完整目标 😀",
    evidence: "{}",
    plan: JSON.parse(planned.text).plan,
    workerScratch: planned.files.workerScratch,
  })
  expect(verifier.paths.plan).not.toBe(planner.paths.plan)
  await expect(verifier.write(planner.paths.plan, "weakened objective")).rejects.toThrow("assigned")
  await expect(verifier.write(verifier.paths.plan, "weakened objective")).rejects.toThrow("assigned")
  await verifier.write(verifier.paths.verdict, '{"achieved":false}')
  await verifier.write(verifier.paths.details, "# Findings\nMissing tests")
  const result = await verifier.finish()
  expect(result.text).toBe('{"achieved":false}')
  expect(result.files.workerScratch).toBe(planned.files.workerScratch)
  expect((await SessionGoalFiles.read(result.files.details!.path)).file).toEqual(result.files.details!)
  await expect(verifier.write(verifier.paths.verdict, "late")).rejects.toThrow("no longer")
})

test("Goal files reject absent, empty, oversized and malformed UTF-8 results", async () => {
  await using tmp = await tmpdir()
  for (const mode of ["missing", "empty", "large", "utf8"]) {
    const report = await SessionGoalFiles.create({
      data: tmp.path,
      kind: "planning",
      objective: "Goal",
      evidence: "{}",
    })
    if (mode === "empty") await report.write(report.paths.plan, "  ")
    if (mode === "large") {
      await expect(report.write(report.paths.plan, "😀".repeat(40_000))).rejects.toThrow("byte limit")
      await writeFile(report.paths.plan, "x".repeat(200_000))
    }
    if (mode === "utf8") await writeFile(report.paths.plan, Buffer.from([0xff]))
    await expect(report.finish()).rejects.toThrow()
  }
})

test("Goal file capabilities reject traversal, other role paths and writes after cancellation", async () => {
  await using tmp = await tmpdir()
  const report = await SessionGoalFiles.create({ data: tmp.path, kind: "planning", objective: "Goal", evidence: "{}" })
  for (const file of [
    path.join(tmp.path, "escape"),
    `${report.paths.plan}/../../escape`,
    report.paths.objective,
    report.paths.details,
  ])
    await expect(report.write(file, "escape")).rejects.toThrow("assigned")
  report.close()
  await expect(report.write(report.paths.plan, "late")).rejects.toThrow("no longer")
})

test("Goal verification requires both reports and preserves immutable original inputs", async () => {
  await using tmp = await tmpdir()
  for (const mode of ["missing-details", "empty-details", "objective", "evidence", "plan", "changes", "changedFiles"]) {
    const report = await SessionGoalFiles.create({
      data: tmp.path,
      kind: "verifying",
      objective: "Goal",
      evidence: "{}",
      plan: "Original criteria",
      changes: { patch: "Original patch", manifest: '{"files":["proof.txt"]}' },
    })
    await report.write(report.paths.verdict, "{}")
    if (mode !== "missing-details")
      await report.write(report.paths.details, mode === "empty-details" ? " " : "Findings")
    if (mode === "objective" || mode === "evidence" || mode === "plan") await writeFile(report.paths[mode], "Tampered")
    if (mode === "changes" || mode === "changedFiles") await writeFile(report.paths[mode], "Tampered")
    await expect(report.finish()).rejects.toThrow()
  }
})
;(process.platform === "win32" ? test.skip : test)(
  "Goal files reject symlinks, hard links, replaced directories and public roots",
  async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "target")
    await writeFile(target, "MUST_NOT_CHANGE")
    for (const mode of ["symlink", "hardlink", "directory"]) {
      const report = await SessionGoalFiles.create({
        data: tmp.path,
        kind: "planning",
        objective: "Goal",
        evidence: "{}",
      })
      if (mode === "symlink") await symlink(target, report.paths.plan)
      if (mode === "hardlink") await link(target, report.paths.plan)
      if (mode === "directory") await mkdir(report.paths.plan)
      await expect(report.write(report.paths.plan, "overwrite")).rejects.toThrow()
      await expect(report.finish()).rejects.toThrow()
      expect(await Bun.file(target).text()).toBe("MUST_NOT_CHANGE")
    }
    const replaced = await SessionGoalFiles.create({
      data: tmp.path,
      kind: "planning",
      objective: "Goal",
      evidence: "{}",
    })
    const directory = path.dirname(replaced.paths.plan)
    await rename(directory, `${directory}-old`)
    await mkdir(directory, { mode: 0o700 })
    await expect(replaced.write(replaced.paths.plan, "wrong directory")).rejects.toThrow("replaced")
    await chmod(path.join(tmp.path, "goal-reviews"), 0o755)
    await expect(
      SessionGoalFiles.create({ data: tmp.path, kind: "planning", objective: "Goal", evidence: "{}" }),
    ).rejects.toThrow("private directory")
  },
)

test("strategy reports can write only advice and reject immutable plan tampering", async () => {
  await using tmp = await tmpdir()
  for (const tamper of [false, true]) {
    const report = await SessionGoalFiles.create({
      data: tmp.path,
      kind: "strategizing",
      objective: "Whole objective",
      evidence: "{}",
      plan: "Original criteria",
    })
    await expect(report.write(report.paths.plan, "Weakened criteria")).rejects.toThrow("assigned")
    await expect(report.write(report.paths.verdict, "{}")).rejects.toThrow("assigned")
    await report.write(report.paths.strategy, "Inspect the failing boundary and reproduce independently.")
    if (tamper) {
      await writeFile(report.paths.plan, "Changed outside scoped capability")
      await expect(report.finish()).rejects.toThrow("Immutable")
      continue
    }
    const result = await report.finish()
    expect(result.text).toContain("failing boundary")
    expect((await SessionGoalFiles.read(result.files.plan.path)).text).toBe("Original criteria")
    expect(result.files.strategy).toBeDefined()
    await expect(report.write(report.paths.strategy, "Late advice")).rejects.toThrow("no longer")
  }
})
