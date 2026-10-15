export * as LSP from "./lsp"

import path from "node:path"
import { Cause, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Schema, Scope, Semaphore } from "effect"
import { LspEvent } from "@apexo/schema/lsp-event"
import { EventV2 } from "./event"
import { Lsp } from "@apexo/schema/lsp"
import { Config } from "./config"
import { ConfigLSP } from "./config/lsp"
import { LocationRuntimeGuard } from "./location-runtime-guard"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { FSUtil } from "./fs-util"
import { PluginBundleState } from "./plugin-bundle-state"
import { makeLocationNode } from "./effect/app-node"
import type { NativeLspClient } from "./lsp-client"

export class Failure extends Schema.TaggedErrorClass<Failure>()("NativeLSP.Failure", {
  code: Schema.Literals(["invalid", "load", "unsupported"]),
  server: Schema.optional(Schema.String),
  message: Schema.String,
}) {}
export interface Prepared {
  readonly verify: () => void
  /** Pure pointer publication after verify; must not throw or suspend. */
  readonly commit: () => void
  readonly retire: Effect.Effect<void>
}
export interface Request {
  operation: Lsp.Operation
  file?: string
  text?: string
  line?: number
  character?: number
  query?: string
}
export type WorkspaceTarget = LocationMutation.Target & { readonly kind: "file" | "directory" }
export type AuthorizeWorkspace = (targets: readonly WorkspaceTarget[]) => Effect.Effect<void, Failure>

export interface Interface {
  readonly status: Effect.Effect<readonly Lsp.Status[]>
  readonly execute: (input: Request, authorize?: AuthorizeWorkspace) => Effect.Effect<unknown[], Failure>
  readonly suspendRecovery: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly prepareReload: (initial?: boolean) => Effect.Effect<Prepared, Failure, Scope.Scope>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/v2/LSP") {}

type Connection = {
  scope: Scope.Closeable
  client: Awaited<ReturnType<typeof NativeLspClient.create>>
  config: ConfigLSP.Server
  commit: () => void
  budget: { attempts: number; delay: number }
}
type Workspace = {
  root: WorkspaceTarget
  solution?: WorkspaceTarget
  projects: WorkspaceTarget[]
  targets: WorkspaceTarget[]
}
type PendingWorkspace = {
  config: ConfigLSP.Server
  workspace: Workspace
  attempted: boolean
  budget: { attempts: number; delay: number }
}
const close = (scope: Scope.Closeable) => Scope.close(scope, Exit.void)
const make = Effect.gen(function* () {
  const config = yield* Config.Service
  const location = yield* Location.Service
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const activation = yield* Semaphore.make(1)
  const bundles = yield* PluginBundleState.Service
  const guard = yield* LocationRuntimeGuard.Service
  const events = yield* EventV2.Service
  const parent = yield* Scope.Scope
  const lifetime = yield* Scope.fork(parent, "sequential")
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const lifecycle = { stopped: false, paused: 0 }
  const jobs = new Map<string, { connection: Connection; fiber: Fiber.Fiber<void> }>()
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      lifecycle.stopped = true
    }),
  )
  const updated = events.publish(LspEvent.Updated, {}, { location }).pipe(Effect.asVoid)
  const current = {
    connections: new Map<string, Connection>(),
    workspaces: new Map<string, PendingWorkspace>(),
    status: new Map<string, Lsp.Status>(),
  }
  const resolveWorkspace = (server: ConfigLSP.Server) =>
    Effect.gen(function* () {
      const root: WorkspaceTarget = {
        ...(yield* mutation.resolve({ path: server.workspaceFolder ?? location.directory, kind: "directory" })),
        kind: "directory",
      }
      if ((yield* fs.stat(root.canonical)).type !== "Directory")
        return yield* new Failure({ code: "invalid", message: "Language-server workspace must be a directory" })
      const target = (file: string) =>
        mutation
          .resolve({ path: path.resolve(root.canonical, file), kind: "file" })
          .pipe(Effect.map((value): WorkspaceTarget => ({ ...value, kind: "file" })))
      const solution = server.workspaceOpen?.solution ? yield* target(server.workspaceOpen.solution) : undefined
      const projects = yield* Effect.forEach(server.workspaceOpen?.projects ?? [], target)
      return {
        root,
        solution,
        projects,
        targets: [root, ...(solution ? [solution] : []), ...projects],
      } satisfies Workspace
    }).pipe(
      Effect.mapError((error) =>
        error instanceof Failure
          ? error
          : new Failure({ code: "invalid", message: "Could not resolve language-server workspace targets" }),
      ),
    )
  const verifyWorkspace = (entry: PendingWorkspace) =>
    resolveWorkspace(entry.config).pipe(
      Effect.flatMap((resolved) =>
        JSON.stringify(resolved.targets) === JSON.stringify(entry.workspace.targets)
          ? Effect.void
          : Effect.fail(
              new Failure({ code: "invalid", message: "Language-server workspace targets changed; reload plugins" }),
            ),
      ),
    )

  const prepareConnection = Effect.fn("LSP.prepareConnection")(function* (
    id: string,
    server: ConfigLSP.Server,
    budget = { attempts: 0, delay: 1_000 },
    workspace?: Workspace,
  ) {
    if (!server.command[0]?.trim() || !server.extensions?.length)
      return yield* new Failure({
        code: "invalid",
        server: id,
        message: "Native language servers require a command and file extensions",
      })
    if (server.extensions.some((value) => !value.startsWith(".") || /[\\/]/.test(value)))
      return yield* new Failure({
        code: "invalid",
        server: id,
        message: "Language-server extensions must be dotted file suffixes",
      })
    const ownership = { committed: false }
    const scope = yield* Effect.acquireRelease(Scope.fork(lifetime, "sequential"), (scope) =>
      ownership.committed ? Effect.void : close(scope),
    )
    const pending: { value?: ReturnType<typeof NativeLspClient.create> } = {}
    const abort = new AbortController()
    // Register teardown before asynchronous initialization. An interrupted
    // startup still joins the create promise's abort/cleanup before scope exit.
    yield* Scope.addFinalizer(
      scope,
      Effect.promise(async () => {
        abort.abort(new Error("Language-server scope closed"))
        const client = await pending.value?.catch(() => undefined)
        if (client) await client.close()
      }).pipe(Effect.timeout((server.timeout?.shutdown ?? 5_000) + 5_000), Effect.orDie),
    )
    const client = yield* Effect.tryPromise({
      try: async (signal) => {
        const { NativeLspClient } = await import("./lsp-client")
        pending.value = NativeLspClient.create({
          command: server.command,
          transport: server.transport,
          root: location.directory,
          ...(workspace
            ? {
                workspaceFolder: workspace.root.canonical,
                workspaceOpen: {
                  ...(workspace.solution ? { solution: workspace.solution.canonical } : {}),
                  projects: workspace.projects.map((target) => target.canonical),
                },
              }
            : {}),
          environment: server.env,
          initialization: server.initialization,
          settings: server.settings,
          startupTimeout: server.timeout?.startup,
          shutdownTimeout: server.timeout?.shutdown,
          requestTimeout: server.timeout?.request,
          signal: AbortSignal.any([signal, abort.signal]),
          onClosed: () => {
            if (!lifecycle.stopped && ownership.committed && current.connections.get(id)?.scope === scope) {
              fork(updated)
              const connection = current.connections.get(id)
              if (connection) schedule(id, connection)
            }
          },
        })
        return pending.value
      },
      catch: () => new Failure({ code: "load", server: id, message: "Could not initialize language server" }),
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close(scope) : Effect.void)))
    return {
      scope,
      client,
      config: server,
      budget,
      commit: () => {
        ownership.committed = true
      },
    } satisfies Connection
  })

  const eligible = (id: string, connection: Connection) =>
    !lifecycle.stopped &&
    !lifecycle.paused &&
    !current.workspaces.has(id) &&
    current.connections.get(id) === connection &&
    connection.config.restartOnCrash === true &&
    !connection.client.healthy()

  const failed = (id: string, connection: Connection, message: string) => {
    if (lifecycle.stopped || current.connections.get(id) !== connection) return
    const status = current.status.get(id)
    if (status) current.status.set(id, { ...status, status: "failed", operations: [], error: message })
    if (!lifecycle.stopped) fork(updated)
  }
  const schedule = (id: string, connection: Connection) => {
    if (!eligible(id, connection) || jobs.has(id)) return
    const recovery = Effect.gen(function* () {
      while (eligible(id, connection)) {
        if (connection.budget.attempts >= (connection.config.maxRestarts ?? 3)) {
          failed(id, connection, "Language-server automatic restart budget exhausted; reload plugins to retry")
          return
        }
        yield* Effect.sleep(connection.budget.delay)
        while (eligible(id, connection)) {
          const attempt = yield* guard
            .idle(
              location,
              Effect.scoped(
                Effect.gen(function* () {
                  if (!eligible(id, connection)) return
                  // Busy checks consume no attempts. Count only a real candidate start;
                  // a successful restart retains this budget across future crashes.
                  connection.budget.attempts++
                  const candidate = yield* prepareConnection(id, connection.config, connection.budget)
                  yield* Effect.sync(() => {
                    if (!eligible(id, connection) || !candidate.client.healthy())
                      throw new Failure({ code: "load", server: id, message: "Language server closed before recovery" })
                    candidate.commit()
                    current.connections.set(id, candidate)
                    connection.budget.delay = 1_000
                    current.status.set(id, {
                      id,
                      name: id,
                      root: location.directory,
                      status: "connected",
                      operations: candidate.client.supported,
                    })
                  }).pipe(Effect.andThen(updated), Effect.andThen(close(connection.scope)), Effect.uninterruptible)
                }),
              ),
            )
            .pipe(Effect.exit)
          if (Exit.isSuccess(attempt) || Cause.hasInterruptsOnly(attempt.cause)) return
          if (Cause.squash(attempt.cause) instanceof LocationRuntimeGuard.Busy) {
            yield* Effect.sleep("100 millis")
            continue
          }
          failed(id, connection, "Could not restart language server")
          connection.budget.delay = Math.min(connection.budget.delay * 2, 30_000)
          break
        }
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logError("Native LSP automatic restart failed", { server: id }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (jobs.get(id)?.connection === connection) jobs.delete(id)
          const replacement = current.connections.get(id)
          if (replacement && replacement !== connection) schedule(id, replacement)
        }),
      ),
    )
    // A zero-budget worker can finish without suspending. Publish its job before
    // releasing the worker so its finalizer can never race map insertion.
    const ready = Deferred.makeUnsafe<void>()
    jobs.set(id, { connection, fiber: fork(Deferred.await(ready).pipe(Effect.andThen(recovery))) })
    Deferred.doneUnsafe(ready, Effect.void)
  }

  // Explicit reload parks recovery before acquiring the Location gate, so it
  // can cancel an in-flight candidate which currently owns that gate. Finalizers
  // join candidate cleanup. Failure/interruption resumes the retained generation.
  const suspendRecovery = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        lifecycle.paused++
      }),
      () =>
        Effect.forEach([...jobs.values()], (job) => Fiber.interrupt(job.fiber), { discard: true }).pipe(
          Effect.andThen(effect),
        ),
      () =>
        Effect.sync(() => {
          lifecycle.paused--
          for (const [id, connection] of current.connections) schedule(id, connection)
        }),
    )

  const prepareReload = Effect.fn("LSP.prepareReload")(function* (initial = false) {
    const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
    const entries = documents.map((entry) => entry.info.lsp).filter((entry) => entry !== undefined)
    const enabled = entries.at(-1) !== false
    const servers = Object.fromEntries(
      entries.flatMap((entry) => (typeof entry === "object" ? Object.entries(entry) : [])),
    )
    const base = new Set(
      documents.slice(1).flatMap((entry) => (typeof entry.info.lsp === "object" ? Object.keys(entry.info.lsp) : [])),
    )
    const installedConfig = (yield* bundles.get).config.lsp
    const installed = new Set(
      typeof installedConfig === "object" ? Object.keys(installedConfig).filter((id) => !base.has(id)) : [],
    )
    const connections = new Map<string, Connection>()
    const statuses = new Map<string, Lsp.Status>()
    const workspaces = new Map<string, PendingWorkspace>()
    const previous = [...current.connections.values()]
    for (const [id, server] of Object.entries(servers)) {
      const common = { id, name: id, root: location.directory }
      if (!enabled || server.disabled) {
        statuses.set(id, { ...common, status: "disabled", operations: [] })
        continue
      }
      if (!("command" in server))
        return yield* new Failure({ code: "invalid", server: id, message: "Language-server command is missing" })
      if (server.workspaceFolder !== undefined || server.workspaceOpen !== undefined) {
        const workspace = yield* resolveWorkspace(server)
        workspaces.set(id, { config: server, workspace, attempted: false, budget: { attempts: 0, delay: 1_000 } })
        statuses.set(id, { ...common, root: workspace.root.canonical, status: "pending", operations: [] })
        continue
      }
      const attempt = yield* prepareConnection(id, server).pipe(Effect.exit)
      if (Exit.isSuccess(attempt)) {
        connections.set(id, attempt.value)
        statuses.set(id, { ...common, status: "connected", operations: attempt.value.client.supported })
        continue
      }
      if (Cause.hasInterruptsOnly(attempt.cause)) return yield* Effect.failCause(attempt.cause)
      const error = Cause.squash(attempt.cause)
      const failure =
        error instanceof Failure
          ? error
          : new Failure({ code: "load", server: id, message: "Could not initialize language server" })
      if (!initial || installed.has(id)) return yield* failure
      statuses.set(id, { ...common, status: "failed", operations: [], error: failure.message })
    }
    return {
      verify: () => {
        for (const [id, connection] of connections)
          if (!connection.client.healthy())
            throw new Failure({ code: "load", server: id, message: "Language server closed before activation" })
      },
      commit: () => {
        for (const connection of connections.values()) connection.commit()
        current.connections = connections
        current.workspaces = workspaces
        current.status = statuses
      },
      retire: updated.pipe(
        Effect.andThen(Effect.forEach(previous, (connection) => close(connection.scope), { discard: true })),
      ),
    } satisfies Prepared
  })

  return Service.of({
    prepareReload,
    suspendRecovery,
    status: Effect.sync(() =>
      [...current.status].map(([id, status]) => {
        const connection = current.connections.get(id)
        return status.status === "connected" && !connection?.client.healthy()
          ? { ...status, status: "failed" as const, error: "Language-server connection closed" }
          : { ...status, operations: [...status.operations] }
      }),
    ),
    execute: (input, authorize) =>
      guard.use(
        location,
        Effect.gen(function* () {
          const configurations = new Map([
            ...[...current.connections].map(([id, connection]) => [id, connection.config] as const),
            ...[...current.workspaces].map(([id, entry]) => [id, entry.config] as const),
          ])
          const candidates = [...configurations].filter(
            ([, server]) =>
              input.operation === "workspaceSymbol" ||
              server.extensions?.some((extension) => input.file?.endsWith(extension)),
          )
          if (!candidates.length)
            return yield* new Failure({
              code: "unsupported",
              message: "No active language server is configured for this file",
            })
          const pending = candidates.flatMap(([id]) => {
            const entry = current.workspaces.get(id)
            return entry ? [{ id, entry }] : []
          })
          const checkWorkspace =
            authorize ??
            (() =>
              Effect.fail(
                new Failure({
                  code: "invalid",
                  message: "Language-server workspace requires current permission",
                }),
              ))
          // Permission decisions belong to the current tool invocation. Checking
          // every target before any activation also prevents partial denied starts.
          if (pending.length) {
            for (const { entry } of pending) yield* verifyWorkspace(entry)
            yield* checkWorkspace(pending.flatMap(({ entry }) => entry.workspace.targets))
            for (const { entry } of pending) yield* verifyWorkspace(entry)
          }
          yield* activation.withPermits(1)(
            Effect.scoped(
              Effect.gen(function* () {
                if (pending.length) yield* checkWorkspace(pending.flatMap(({ entry }) => entry.workspace.targets))
                for (const { id, entry } of pending) {
                  yield* verifyWorkspace(entry)
                  const previous = current.connections.get(id)
                  if (previous?.client.healthy()) continue
                  if (entry.attempted) {
                    if (!entry.config.restartOnCrash || entry.budget.attempts >= (entry.config.maxRestarts ?? 3))
                      return yield* new Failure({
                        code: "load",
                        server: id,
                        message: "Language-server restart budget exhausted; reload plugins",
                      })
                    yield* Effect.sleep(entry.budget.delay)
                  }
                  yield* checkWorkspace(entry.workspace.targets)
                  yield* verifyWorkspace(entry)
                  if (entry.attempted) entry.budget.attempts++
                  entry.attempted = true
                  const candidate = yield* prepareConnection(id, entry.config, entry.budget, entry.workspace).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() => {
                        entry.budget.delay = Math.min(entry.budget.delay * 2, 30_000)
                        current.status.set(id, {
                          id,
                          name: id,
                          root: entry.workspace.root.canonical,
                          status: "failed",
                          operations: [],
                          error: "Could not initialize authorized language-server workspace",
                        })
                      }).pipe(Effect.andThen(updated)),
                    ),
                  )
                  if (!candidate.client.healthy())
                    return yield* new Failure({
                      code: "load",
                      server: id,
                      message: "Language server closed before activation",
                    })
                  yield* Effect.sync(() => {
                    candidate.commit()
                    current.connections.set(id, candidate)
                    entry.budget.delay = 1_000
                    current.status.set(id, {
                      id,
                      name: id,
                      root: entry.workspace.root.canonical,
                      status: "connected",
                      operations: candidate.client.supported,
                    })
                  }).pipe(
                    Effect.andThen(updated),
                    Effect.andThen(previous ? close(previous.scope) : Effect.void),
                    Effect.uninterruptible,
                  )
                }
              }),
            ),
          )
          const supported = candidates.flatMap(([id]) => {
            const connection = current.connections.get(id)
            return connection?.client.supported.includes(input.operation) ? [[id, connection] as const] : []
          })
          if (!supported.length)
            return yield* new Failure({
              code: "unsupported",
              message: `Active language servers do not support ${input.operation}`,
            })
          const results = yield* Effect.forEach(supported, ([id, connection]) =>
            Effect.tryPromise({
              try: (signal) =>
                connection.client.execute(
                  {
                    ...input,
                    languageId: input.file
                      ? (connection.config.languageIds?.[path.extname(input.file)] ?? languageId(input.file))
                      : undefined,
                  },
                  signal,
                ),
              catch: () =>
                new Failure({ code: "load", server: id, message: "Language-server request failed or was interrupted" }),
            }),
          )
          return results.flatMap((result) =>
            result === null || result === undefined ? [] : Array.isArray(result) ? result : [result],
          )
        }),
      ),
  })
})
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    Config.node,
    Location.node,
    LocationMutation.node,
    FSUtil.node,
    PluginBundleState.node,
    EventV2.node,
    LocationRuntimeGuard.node,
  ],
})

function languageId(file: string) {
  const known: Record<string, string> = {
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".hpp": "cpp",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
  }
  return known[path.extname(file)] ?? "plaintext"
}
