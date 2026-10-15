import { Clock, Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"

const StatusCommand = effectCmd({
  command: "status",
  describe: "inspect Memory V2 health without running capture or maintenance",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("global", { type: "boolean", describe: "inspect global memory" })
      .option("all", { type: "boolean", describe: "inspect workspace and global memory" })
      .option("json", { type: "boolean", describe: "print structured health data" })
      .conflicts("global", "all"),
  handler: Effect.fn("Cli.memory.status")(function* (args) {
    const { Global } = yield* Effect.promise(() => import("@apexo/core/global"))
    const { MemoryHealth } = yield* Effect.promise(() => import("@apexo/core/memory-health"))
    const { Project } = yield* Effect.promise(() => import("@/project/project"))
    const projects = yield* Project.Service
    const directory = process.cwd()
    const project = (yield* projects.fromDirectory(directory)).project
    const now = yield* Clock.currentTimeMillis
    const scopes = yield* Effect.forEach(
      args.all ? (["workspace", "global"] as const) : args.global ? (["global"] as const) : (["workspace"] as const),
      (scope) =>
        MemoryHealth.inspect(
          { home: Global.Path.home, directory, projectID: project.id, permitted: () => true },
          scope,
          now,
        ),
    )
    if (args.json) {
      console.log(JSON.stringify({ backend: "v2", scopes }, null, 2))
      return
    }
    for (const scope of scopes) {
      console.log(`${scope.scope}: ${scope.state}${scope.reason ? ` (${scope.reason})` : ""}`)
      if (!scope.snapshot) continue
      console.log(
        `  Capture: ${scope.snapshot.pendingCaptureJobs} pending, ${scope.snapshot.runningCaptureJobs} running, ${scope.snapshot.publishingCaptureJobs} publishing, ${scope.snapshot.retryCaptureJobs} retry, ${scope.snapshot.failedCaptureJobs} failed, ${scope.snapshot.completedCaptureJobs} completed`,
      )
      console.log(
        `  Observations: ${scope.snapshot.pendingObservations} visible, ${scope.snapshot.hiddenPendingObservations} hidden, ${scope.snapshot.quarantinedObservations} quarantined; oldest age: ${scope.snapshot.oldestPendingAgeSecs ?? "unknown"} seconds`,
      )
      console.log(
        `  Dream: ${scope.snapshot.dreamLease}; snapshot: ${scope.snapshot.dreamSnapshotSize}; saved plan: ${scope.snapshot.dreamPlanPending}; coalesced trigger: ${scope.snapshot.hasCoalescedTrigger}`,
      )
      console.log(
        `  Maintenance: ${scope.snapshot.archiveCount} archives, ${scope.snapshot.tombstoneCount} tombstones, ${scope.snapshot.pendingDeletions} pending deletions`,
      )
      console.log(
        `  Last success: ${scope.snapshot.lastSuccessAt === null ? "none" : new Date(scope.snapshot.lastSuccessAt).toISOString()}; last failure: ${scope.snapshot.lastFailureAt === null ? "none" : new Date(scope.snapshot.lastFailureAt).toISOString()}`,
      )
    }
  }),
})

const ClearCommand = effectCmd({
  command: "clear",
  describe: "clear saved memory (current workspace by default)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("workspace", { type: "boolean", describe: "clear current workspace memory" })
      .option("global", { type: "boolean", describe: "clear global memory" })
      .option("all", { type: "boolean", describe: "clear current workspace and global memory; keep other projects" })
      .option("yes", { alias: "y", type: "boolean", describe: "skip confirmation" })
      .option("backend", {
        choices: ["legacy", "v2"] as const,
        describe: "memory backend (defaults to project configuration)",
      })
      .conflicts("workspace", ["global", "all"])
      .conflicts("global", "all"),
  handler: Effect.fn("Cli.memory.clear")(function* (args) {
    const { Global } = yield* Effect.promise(() => import("@apexo/core/global"))
    const { WorkspaceMemory } = yield* Effect.promise(() => import("@apexo/core/workspace-memory"))
    const { MemoryMaintenance } = yield* Effect.promise(() => import("@apexo/core/memory-maintenance"))
    const { Project } = yield* Effect.promise(() => import("@/project/project"))
    const { Database } = yield* Effect.promise(() => import("@apexo/core/database/database"))
    const { SessionMemoryContextTable } = yield* Effect.promise(() => import("@apexo/core/session/sql"))
    const { and, eq } = yield* Effect.promise(() => import("drizzle-orm"))
    const { default: path } = yield* Effect.promise(() => import("node:path"))
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const global = Global.Path
    const projects = yield* Project.Service
    const database = yield* Database.Service
    const directory = process.cwd()
    const resolved = yield* projects.fromDirectory(directory)
    const project = resolved.project
    const config = yield* Config.Service
    const configValue = (yield* config
      .get()
      .pipe(Effect.provideService(InstanceRef, { directory, worktree: resolved.sandbox, project }))).memory_v2
    const backend = args.backend ?? (configValue?.enabled ? "v2" : "legacy")
    const scopes = args.all
      ? (["workspace", "global"] as const)
      : args.global
        ? (["global"] as const)
        : (["workspace"] as const)
    if (backend === "v2") {
      const { MemoryCapture } = yield* Effect.promise(() => import("@apexo/core/memory-capture"))
      const { MemoryV2 } = yield* Effect.promise(() => import("@apexo/core/memory-v2"))
      const { access } = yield* Effect.promise(() => import("node:fs/promises"))
      yield* Effect.scoped(
        Effect.gen(function* () {
          const targets = [] as {
            scope: "global" | "workspace"
            store: Effect.Success<ReturnType<typeof MemoryCapture.make>>
          }[]
          for (const scope of scopes) {
            const location = { home: global.home, directory, projectID: project.id, scope }
            if (
              !(yield* Effect.tryPromise(() =>
                access(MemoryV2.directory(location)).then(
                  () => true,
                  (error: unknown) => {
                    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
                      return false
                    throw error
                  },
                ),
              ))
            )
              continue
            targets.push({
              scope,
              store: yield* MemoryCapture.make(location, {
                recover: false,
                compactIndex: configValue?.compact_index_enabled,
              }),
            })
          }
          if (!targets.length) {
            console.log("Nothing to clear: no memory files found.")
            return
          }
          console.log("The following Memory V2 scopes will be cleared, including notes and pending captures:")
          for (const target of targets) console.log(`  ${target.scope} memory: ${target.store.root.path}`)
          if (!args.yes && !(yield* confirm())) {
            console.log("Cancelled.")
            return
          }
          for (const target of targets) {
            yield* target.store.clear
            const rows = yield* database.db.select().from(SessionMemoryContextTable)
            for (const row of rows) {
              if (!row.access_paths.some((file) => file.startsWith(`${target.store.root.path}${path.sep}`))) continue
              yield* database.db
                .delete(SessionMemoryContextTable)
                .where(
                  and(
                    eq(SessionMemoryContextTable.session_id, row.session_id),
                    eq(SessionMemoryContextTable.epoch, row.epoch),
                  ),
                )
            }
            console.log(`  Cleared: ${target.scope} memory`)
          }
          console.log("Memory cleared.")
        }),
      ).pipe(Effect.catch((error) => fail(`Could not clear Memory V2: ${String(error)}`)))
      return
    }
    const locations = scopes.map((scope) => ({
      scope,
      ...WorkspaceMemory.maintenance(directory, global.home, { scope, projectID: project?.id }),
    }))
    const legacy = WorkspaceMemory.maintenance(directory, global.home)
    const targets = yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          locations.map(async (location) => ({
            ...location,
            files: await MemoryMaintenance.targets(location, location.scope),
            legacy:
              location.scope === "workspace" && legacy.root !== location.root
                ? await MemoryMaintenance.targets(legacy, "workspace")
                : [],
          })),
        ),
      catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
    }).pipe(Effect.catch((error) => fail(error.message)))
    if (!targets.some((target) => target.files.length || target.legacy.length)) {
      console.log("Nothing to clear: no memory files found.")
      return
    }
    console.log("The following will be deleted:")
    for (const target of targets)
      for (const file of [...target.files, ...target.legacy]) console.log(`  ${target.scope} memory: ${file}`)
    if (!args.yes) {
      if (!(yield* confirm())) {
        console.log("Cancelled.")
        return
      }
    }
    for (const target of targets) {
      yield* Effect.tryPromise({
        try: async () => {
          await MemoryMaintenance.clear(target, target.scope, target.legacy.length > 0)
          if (target.legacy.length) await MemoryMaintenance.clear(legacy, "workspace")
        },
        catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.catch((error) => fail(`Could not clear ${target.scope} memory: ${error.message}`)))
      // Cached snippets are derived memory too. Delete rows for either path spelling;
      // the filesystem generation also invalidates already-open CLI/Desktop instances.
      const roots = [...new Set([target.root, ...target.files, ...target.legacy])]
      const rows = yield* database.db
        .select()
        .from(SessionMemoryContextTable)
        .pipe(Effect.catch((error) => fail(error.message)))
      for (const row of rows) {
        if (
          !row.access_paths.some((file) =>
            roots.some((root) => {
              const relative = path.relative(root, file)
              if (target.scope === "workspace")
                return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
              return target.files.some((selected) => file === selected || file.startsWith(`${selected}${path.sep}`))
            }),
          )
        )
          continue
        yield* database.db
          .delete(SessionMemoryContextTable)
          .where(
            and(
              eq(SessionMemoryContextTable.session_id, row.session_id),
              eq(SessionMemoryContextTable.epoch, row.epoch),
            ),
          )
          .pipe(Effect.catch((error) => fail(error.message)))
      }
      if (target.files.length || target.legacy.length) console.log(`  Cleared: ${target.scope} memory`)
    }
    console.log("Memory cleared.")
  }),
})

const confirm = Effect.fn("Cli.memory.confirm")(function* () {
  const { createInterface } = yield* Effect.promise(() => import("node:readline"))
  return yield* Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
        prompt.once("line", (line) => {
          resolve(["y", "yes"].includes(line.trim().toLowerCase()))
          prompt.close()
        })
        prompt.once("close", () => resolve(false))
        process.stdout.write("Are you sure? [y/N] ")
      }),
  )
})

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage saved memory",
  builder: (yargs) => yargs.command(ClearCommand).command(StatusCommand).demandCommand(),
  async handler() {},
})
