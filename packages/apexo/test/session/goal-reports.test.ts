import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { link, rename, symlink, unlink } from "node:fs/promises"
import path from "node:path"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { SessionGoalFiles } from "@apexo/core/session/goal-files"
import { SessionGoalReports } from "@apexo/core/session/goal-reports"
import { tmpdir } from "../fixture/fixture"

const owner = { sessionID: SessionID.make("ses_reporttest"), goalID: Goal.ID.make("goal_reporttest") }

test("Goal reports support accepted custom Session IDs without using them as filesystem paths", async () => {
  await using tmp = await tmpdir()
  const ids = [
    "ses_media_reused",
    "ses/../../outside",
    "ses\\outside",
    "ses_中文",
    "ses_\u0000",
    `ses_${"a".repeat(300)}`,
  ]
  const directories = new Set<string>()
  for (const id of ids) {
    const custom = { sessionID: SessionID.make(id), goalID: owner.goalID }
    expect(await SessionGoalReports.owners(tmp.path, custom.sessionID)).toEqual([])
    const files = await SessionGoalFiles.create({
      data: tmp.path,
      owner: custom,
      kind: "planning",
      objective: "Custom Session report",
      evidence: "{}",
    })
    const relative = path.relative(path.join(tmp.path, "goal-reviews"), files.paths.plan).split(path.sep)
    expect(relative).toHaveLength(4)
    expect(relative[0]).not.toBe("..")
    directories.add(relative[0]!)
    await files.write(files.paths.plan, `# Plan for ${JSON.stringify(id)}`)
    const finished = await files.finish()
    const reports = SessionGoalReports.make({ data: tmp.path, ...custom })
    expect(await SessionGoalReports.owners(tmp.path, custom.sessionID)).toEqual([custom.goalID])
    expect((await reports.read(path.basename(finished.files.directory), "plan")).text).toBe(
      `# Plan for ${JSON.stringify(id)}`,
    )
    expect(await reports.cleanup()).toEqual({ removed: 1, failed: [] })
    expect(await reports.list()).toEqual([])
  }
  expect(directories.size).toBe(ids.length)
})

test("Goal report catalog persists finalized and incomplete attempts and isolates owners", async () => {
  await using tmp = await tmpdir()
  const files = await SessionGoalFiles.create({
    data: tmp.path,
    owner,
    kind: "planning",
    objective: "完整目标",
    evidence: "{}",
  })
  const reports = SessionGoalReports.make({ data: tmp.path, ...owner })
  expect(await reports.list()).toMatchObject([{ complete: false, files: [] }])
  const id = path.basename(path.dirname(files.paths.plan))
  await expect(reports.read(id, "plan")).rejects.toThrow("not been finalized")
  await files.write(files.paths.plan, "# Plan\n中文 😀")
  const finished = await files.finish()
  const reopened = SessionGoalReports.make({ data: tmp.path, ...owner })
  expect(await reopened.list()).toMatchObject([{ id, complete: true, kind: "planning" }])
  expect(await reopened.read(id, "plan")).toEqual({
    name: "plan.md",
    contentType: "text/plain; charset=utf-8",
    text: "# Plan\n中文 😀",
    bytes: finished.files.plan.bytes,
    sha256: finished.files.plan.sha256,
  })
  const other = SessionGoalReports.make({ data: tmp.path, ...owner, sessionID: SessionID.make("ses_other") })
  expect(await other.list()).toEqual([])
  await expect(other.read(id, "plan")).rejects.toThrow("missing")
  await expect(reports.read("../reporttest", "plan")).rejects.toThrow("Invalid")
  const failed = await SessionGoalFiles.create({
    data: tmp.path,
    owner,
    kind: "planning",
    objective: "Incomplete",
    evidence: "{}",
  })
  failed.close()
  expect(await reports.list()).toHaveLength(2)
  expect(await reports.cleanup()).toEqual({ removed: 2, failed: [] })
  expect(await reports.list()).toEqual([])
  expect(await reports.cleanup()).toEqual({ removed: 0, failed: [] })
})

test("Goal report reads reject modified bytes, wrong metadata paths, hard links and symbolic links", async () => {
  await using tmp = await tmpdir()
  const files = await SessionGoalFiles.create({
    data: tmp.path,
    owner,
    kind: "planning",
    objective: "Goal",
    evidence: "{}",
  })
  await files.write(files.paths.plan, "# Plan")
  const finished = await files.finish()
  const reports = SessionGoalReports.make({ data: tmp.path, ...owner })
  const id = path.basename(finished.files.directory)
  await Bun.write(files.paths.plan, "# Forged")
  await expect(reports.read(id, "plan")).rejects.toThrow("changed after finalization")
  await Bun.write(files.paths.plan, "# Plan")
  const catalog = path.join(finished.files.directory, ".report.json")
  const original = await Bun.file(catalog).text()
  const value = JSON.parse(original)
  value.files.plan.path = files.paths.objective
  await Bun.write(catalog, JSON.stringify(value))
  await expect(reports.read(id, "plan")).rejects.toThrow("assigned name")
  await Bun.write(catalog, original)
  if (process.platform === "win32") return
  await unlink(files.paths.plan)
  await link(files.paths.objective, files.paths.plan)
  await expect(reports.read(id, "plan")).rejects.toThrow("integrity")
  await unlink(files.paths.plan)
  await symlink(files.paths.objective, files.paths.plan)
  await expect(reports.read(id, "plan")).rejects.toThrow("integrity")
})

test("Goal report cleanup retries quarantined directories and never follows another directory", async () => {
  await using tmp = await tmpdir()
  await using outside = await tmpdir()
  const files = await SessionGoalFiles.create({
    data: tmp.path,
    owner,
    kind: "planning",
    objective: "Goal",
    evidence: "{}",
  })
  await files.write(files.paths.plan, "# Plan")
  const finished = await files.finish()
  const id = path.basename(finished.files.directory)
  await rename(finished.files.directory, path.join(path.dirname(finished.files.directory), `.deleting-${id}-1234`))
  const reports = SessionGoalReports.make({ data: tmp.path, ...owner })
  expect(await reports.cleanup()).toEqual({ removed: 1, failed: [] })
  if (process.platform === "win32") return
  await Bun.write(path.join(outside.path, "keep.txt"), "KEEP")
  await symlink(outside.path, finished.files.directory)
  expect(await reports.cleanup()).toEqual({ removed: 0, failed: [id] })
  expect(await Bun.file(path.join(outside.path, "keep.txt")).text()).toBe("KEEP")
})

test("Goal report management retains compatibility with durable legacy flat directory references", async () => {
  await using tmp = await tmpdir()
  const files = await SessionGoalFiles.create({ data: tmp.path, kind: "planning", objective: "Goal", evidence: "{}" })
  await files.write(files.paths.plan, "# Original")
  const finished = await files.finish()
  const info = Goal.Info.make({
    id: owner.goalID,
    sessionID: owner.sessionID,
    objective: "Goal",
    status: "complete",
    phase: "idle",
    tokensUsed: 0,
    elapsedMs: 0,
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
    workerRounds: 0,
    verificationRounds: 0,
    unmet: [],
    history: [],
    plannerFiles: finished.files,
  })
  const reports = SessionGoalReports.make({ data: tmp.path, ...owner, info })
  expect(await reports.list()).toMatchObject([{ kind: "planning", complete: true }])
  expect((await reports.read(path.basename(finished.files.directory), "plan")).text).toBe("# Original")
  // Simulate interruption after the cleanup rename but before recursive removal.
  await rename(
    finished.files.directory,
    path.join(path.dirname(finished.files.directory), `.deleting-${path.basename(finished.files.directory)}-1234`),
  )
  await reports.prepareCleanup()
  const afterGoalWasCleared = SessionGoalReports.make({ data: tmp.path, ...owner })
  expect(await afterGoalWasCleared.cleanup()).toEqual({ removed: 1, failed: [] })
  expect(await reports.list()).toEqual([])
})

test("Goal report downloads anchor hashes in persisted Goal state even if the disk catalog is rewritten", async () => {
  await using tmp = await tmpdir()
  const files = await SessionGoalFiles.create({
    data: tmp.path,
    owner,
    kind: "planning",
    objective: "Goal",
    evidence: "{}",
  })
  await files.write(files.paths.plan, "# Original")
  const finished = await files.finish()
  const info = Goal.Info.make({
    id: owner.goalID,
    sessionID: owner.sessionID,
    objective: "Goal",
    status: "complete",
    phase: "idle",
    tokensUsed: 0,
    elapsedMs: 0,
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
    workerRounds: 0,
    verificationRounds: 0,
    unmet: [],
    history: [],
    plannerFiles: finished.files,
  })
  const catalog = path.join(finished.files.directory, ".report.json")
  const metadata = await Bun.file(catalog).json()
  await Bun.write(files.paths.plan, "# Forged")
  metadata.files.plan.sha256 = createHash("sha256").update("# Forged").digest("hex")
  metadata.files.plan.bytes = Buffer.byteLength("# Forged")
  await Bun.write(catalog, JSON.stringify(metadata))
  const reports = SessionGoalReports.make({ data: tmp.path, ...owner, info })
  await expect(reports.read(path.basename(finished.files.directory), "plan")).rejects.toThrow(
    "changed after finalization",
  )
})
