import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, realpath, rename, rm, unlink } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { NonNegativeInt, optional } from "@apexo/schema/schema"
import { SessionGoalFiles } from "./goal-files"

const metadata = Schema.Struct({
  sessionID: SessionID,
  goalID: Goal.ID,
  kind: Schema.Literals(["planning", "verifying", "strategizing"]),
  createdAt: NonNegativeInt,
  files: optional(Goal.ReviewFiles),
})
const decode = Schema.decodeUnknownSync(Schema.UnknownFromJsonString.pipe(Schema.decodeTo(metadata)))
const decodeCleanup = Schema.decodeUnknownSync(
  Schema.UnknownFromJsonString.pipe(
    Schema.decodeTo(
      Schema.Struct({
        sessionID: SessionID,
        goalID: Goal.ID,
        legacy: Schema.Array(Goal.ReportID).check(Schema.isMaxLength(64)),
      }),
    ),
  ),
)
const quarantined = /^\.deleting-(review-[a-zA-Z0-9]+)-[a-f0-9-]+$/
const names = {
  objective: "objective.txt",
  evidence: "evidence.json",
  plan: "plan.md",
  verdict: "verdict.json",
  details: "details.md",
  strategy: "strategy.md",
  changes: "changes.patch",
  changedFiles: "changed-files.json",
} satisfies Record<Goal.ReportFileKey, string>
const keys = Object.keys(names) as Goal.ReportFileKey[]

export class Unavailable extends Error {
  constructor(
    readonly reason: "missing" | "invalid",
    message: string,
  ) {
    super(message)
  }
}

export type Target = {
  data: string
  sessionID: SessionID
  goalID: Goal.ID
  info?: Goal.Info
}

/** Called only while the owning Session still exists in the caller's database. */
export async function owners(data: string, sessionID: SessionID) {
  const directory = path.join(await realpath(data), "goal-reviews", SessionGoalFiles.sessionDirectory(sessionID))
  const found = await SessionGoalFiles.privateDirectory(directory).catch((error: unknown) => {
    if (!missing(error)) throw error
  })
  if (!found) return []
  const entries = await readdir(directory)
  if (entries.length > 10_000) throw new Unavailable("invalid", "Goal directory exceeds its entry limit")
  return entries.filter(Schema.is(Goal.ID))
}

/** Uses only server-owned IDs and persisted references, never a client-supplied filesystem path. */
export function make(input: Target) {
  if (!Schema.is(SessionID)(input.sessionID) || !Schema.is(Goal.ID)(input.goalID))
    throw new Unavailable("invalid", "Invalid Goal report owner")
  const legacy =
    input.info?.id === input.goalID && input.info.sessionID === input.sessionID
      ? [
          input.info.plannerFiles,
          input.info.strategy?.files,
          ...(input.info.verification?.results.map((item) => item.files) ?? []),
          input.info.verification?.previous?.files,
        ].filter((item): item is Goal.ReviewFiles => !!item)
      : []
  const roots = async () => {
    const root = path.join(await realpath(input.data), "goal-reviews")
    return { root, owned: path.join(root, SessionGoalFiles.sessionDirectory(input.sessionID), input.goalID) }
  }
  const entries = async (directory: string) => {
    const found = await lstat(directory).catch((error: unknown) => {
      if (missing(error)) return
      throw error
    })
    if (!found) return []
    await SessionGoalFiles.privateDirectory(directory)
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.length > 10_000) throw new Unavailable("invalid", "Goal report directory exceeds its entry limit")
    return entries
  }
  const resolve = async (id: string) => {
    if (!Schema.is(Goal.ReportID)(id)) throw new Unavailable("invalid", "Invalid Goal report ID")
    const dirs = await roots()
    const historical = legacy.find((item) => item.directory === path.join(dirs.root, id))
    const directory = historical?.directory ?? path.join(dirs.owned, id)
    await SessionGoalFiles.privateDirectory(dirs.root)
    await SessionGoalFiles.privateDirectory(directory)
    if (historical)
      return {
        directory,
        files: historical,
        kind: historical.strategy
          ? ("strategizing" as const)
          : historical.verdict
            ? ("verifying" as const)
            : ("planning" as const),
      }
    const value = decode((await SessionGoalFiles.read(path.join(directory, ".report.json"), 128 * 1024)).text)
    if (value.sessionID !== input.sessionID || value.goalID !== input.goalID)
      throw new Unavailable("invalid", "Goal report ownership does not match")
    if (value.files && value.files.directory !== directory)
      throw new Unavailable("invalid", "Goal report directory does not match its catalog")
    // Current/previous reports have a durable authority outside the mutable disk catalog.
    const persisted = legacy.find((item) => item.directory === directory)
    return { directory, ...value, files: persisted ?? value.files }
  }
  const normalize = (error: unknown) => {
    if (error instanceof Unavailable) return error
    return new Unavailable(
      missing(error) ? "missing" : "invalid",
      missing(error)
        ? "Goal report is missing or has been cleaned up"
        : "Goal report is unavailable or failed integrity validation",
    )
  }
  const cleanupJournal = async () => {
    const dirs = await roots()
    const text = await SessionGoalFiles.read(path.join(dirs.owned, ".cleanup.json"), 16 * 1024).catch(
      (error: unknown) => {
        if (missing(error)) return
        throw error
      },
    )
    if (!text) return []
    const journal = decodeCleanup(text.text)
    if (journal.sessionID !== input.sessionID || journal.goalID !== input.goalID)
      throw new Unavailable("invalid", "Goal cleanup ownership does not match")
    return journal.legacy
  }
  // Persist legacy ownership before clearing the database row, so a crash does not orphan its flat directories.
  const prepareCleanup = async () => {
    const dirs = await roots()
    const ids = legacy
      .filter((item) => path.dirname(item.directory) === dirs.root)
      .map((item) => path.basename(item.directory))
      .filter(Schema.is(Goal.ReportID))
    if (!ids.length) return
    await SessionGoalFiles.privateDirectory(dirs.root)
    for (const directory of [path.dirname(dirs.owned), dirs.owned]) {
      await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error
      })
      await SessionGoalFiles.privateDirectory(directory)
    }
    const journal = {
      sessionID: input.sessionID,
      goalID: input.goalID,
      legacy: [...new Set([...(await cleanupJournal()), ...ids])],
    }
    await SessionGoalFiles.publish(
      path.join(dirs.owned, ".cleanup.json"),
      JSON.stringify(journal),
      16 * 1024,
      async () => {
        await SessionGoalFiles.privateDirectory(dirs.root)
        await SessionGoalFiles.privateDirectory(dirs.owned)
      },
    )
  }
  const candidates = async () => {
    const dirs = await roots()
    const legacyIDs = new Set([
      ...(await cleanupJournal()),
      ...legacy
        .filter((item) => path.dirname(item.directory) === dirs.root)
        .map((item) => path.basename(item.directory))
        .filter(Schema.is(Goal.ReportID)),
    ])
    return [
      ...new Map(
        [
          ...(await entries(dirs.owned))
            .filter((entry) => Schema.is(Goal.ReportID)(entry.name) || quarantined.test(entry.name))
            .map((entry) => ({
              directory: path.join(dirs.owned, entry.name),
              id: entry.name.match(/review-[a-zA-Z0-9]+/)![0],
            })),
          ...[...legacyIDs].map((id) => ({ directory: path.join(dirs.root, id), id })),
          ...(legacyIDs.size ? await entries(dirs.root) : []).flatMap((entry) => {
            const match = entry.name.match(quarantined)
            return match && legacyIDs.has(match[1]!)
              ? [{ directory: path.join(dirs.root, entry.name), id: match[1]! }]
              : []
          }),
        ].map((item) => [item.directory, item]),
      ).values(),
    ]
  }
  return {
    prepareCleanup,
    // Snapshot IDs before deleting durable ownership. A retry must not discover a new Goal lifetime's files.
    ids: async () => [...new Set((await candidates()).map((item) => item.id))],
    pruneScratch: async (ids: readonly string[]): Promise<Goal.ReportCleanup> => {
      const result = { removed: 0, failed: [] as string[] }
      for (const item of (await candidates()).filter((item) => ids.includes(item.id))) {
        await (async () => {
          await SessionGoalFiles.privateDirectory(item.directory)
          for (const entry of await entries(item.directory)) {
            if (entry.name !== "worker" && !/^\.deleting-worker-[a-f0-9-]+$/.test(entry.name)) continue
            // Only the literal, owned worker directory is disposable; never follow a persisted arbitrary scratch path.
            const scratch = path.join(item.directory, entry.name)
            await SessionGoalFiles.privateDirectory(scratch)
            const quarantine =
              entry.name === "worker" ? path.join(item.directory, `.deleting-worker-${randomUUID()}`) : scratch
            if (quarantine !== scratch) await rename(scratch, quarantine)
            await SessionGoalFiles.privateDirectory(quarantine)
            await rm(quarantine, { recursive: true })
            result.removed++
          }
        })().catch((error: unknown) => {
          if (!missing(error)) result.failed.push(item.id)
        })
      }
      return result
    },
    list: async (): Promise<Goal.Report[]> => {
      const dirs = await roots()
      const ids = [
        ...new Set([
          ...(await entries(dirs.owned))
            .filter((entry) => Schema.is(Goal.ReportID)(entry.name))
            .map((entry) => entry.name),
          ...legacy
            .filter((item) => path.dirname(item.directory) === dirs.root)
            .map((item) => path.basename(item.directory)),
        ]),
      ]
      const result = []
      for (const id of ids) {
        const value = await resolve(id).catch((error: unknown) => {
          if (missing(error)) return
          throw normalize(error)
        })
        if (!value) continue
        result.push({
          id,
          kind: value.kind,
          ...("createdAt" in value ? { createdAt: value.createdAt } : {}),
          complete: !!value.files,
          files: keys.flatMap((key) => {
            const file = value.files?.[key]
            if (!file) return []
            if (file.path !== path.join(value.directory, names[key]))
              throw new Unavailable("invalid", "Goal report file does not match its assigned name")
            return [{ key, name: names[key], bytes: file.bytes, sha256: file.sha256 }]
          }),
        })
      }
      return result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id))
    },
    read: async (id: string, key: Goal.ReportFileKey): Promise<Goal.ReportContent> => {
      const value = await resolve(id).catch((error: unknown) => {
        throw normalize(error)
      })
      const expected = value.files?.[key]
      if (!expected) throw new Unavailable("missing", "Goal report file has not been finalized")
      if (expected.path !== path.join(value.directory, names[key]))
        throw new Unavailable("invalid", "Goal report file does not match its assigned name")
      const result = await SessionGoalFiles.read(expected.path, 4 * 1024 * 1024).catch((error: unknown) => {
        throw normalize(error)
      })
      if (result.file.sha256 !== expected.sha256 || result.file.bytes !== expected.bytes)
        throw new Unavailable("invalid", "Goal report contents changed after finalization")
      return {
        name: names[key],
        contentType: names[key].endsWith(".json") ? "application/json" : "text/plain; charset=utf-8",
        text: result.text,
        bytes: result.file.bytes,
        sha256: result.file.sha256,
      }
    },
    /** The caller must stop execution and forbid resuming the Goal before invoking cleanup. */
    cleanup: async (ids?: readonly string[]): Promise<Goal.ReportCleanup> => {
      await prepareCleanup()
      const dirs = await roots()
      const result = { removed: 0, failed: [] as string[] }
      for (const item of (await candidates()).filter((item) => !ids || ids.includes(item.id))) {
        await (async () => {
          await SessionGoalFiles.privateDirectory(dirs.root)
          await SessionGoalFiles.privateDirectory(item.directory)
          const quarantine = path.basename(item.directory).startsWith(".deleting-")
            ? item.directory
            : path.join(dirs.owned, `.deleting-${item.id}-${randomUUID()}`)
          if (quarantine !== item.directory) await rename(item.directory, quarantine)
          await SessionGoalFiles.privateDirectory(quarantine)
          await rm(quarantine, { recursive: true })
          result.removed++
        })().catch((error: unknown) => {
          if (!missing(error)) result.failed.push(item.id)
        })
      }
      if (!result.failed.length && !ids)
        await unlink(path.join(dirs.owned, ".cleanup.json")).catch((error: unknown) => {
          if (!missing(error)) throw error
        })
      return result
    },
  }
}

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

export * as SessionGoalReports from "./goal-reports"
