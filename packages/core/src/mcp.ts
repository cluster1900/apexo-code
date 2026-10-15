export * as MCP from "./mcp"

import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { Cause, Context, Effect, Exit, Fiber, FiberSet, Layer, Schema, Scope } from "effect"
import { Mcp } from "@apexo/schema/mcp"
import { McpEvent } from "@apexo/schema/mcp-event"
import { Config } from "./config"
import { EventV2 } from "./event"
import { ConfigMCP } from "./config/mcp"
import { Location } from "./location"
import { LocationRuntimeGuard } from "./location-runtime-guard"
import { PermissionV2 } from "./permission"
import { PluginBundleState } from "./plugin-bundle-state"
import { ToolRegistry } from "./tool/registry"
import { Tools } from "./tool/tools"
import { McpTools } from "./mcp-tools"
import { McpResources } from "./mcp-resources"
import { McpOAuth } from "./mcp-oauth"
import { McpPreferences } from "./mcp-preferences"
import { Global } from "./global"
import { makeLocationNode } from "./effect/app-node"
import { InstallationVersion } from "./installation/version"

export class Failure extends Schema.TaggedErrorClass<Failure>()("MCP.Failure", {
  code: Schema.Literals(["invalid", "load", "auth", "unsupported", "busy", "not_found", "storage"]),
  server: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export interface Prepared {
  readonly commit: () => void
  readonly retire: Effect.Effect<void>
}
export interface Interface {
  readonly status: Effect.Effect<Mcp.StatusMap>
  readonly authStart: (server: string) => Effect.Effect<Mcp.AuthenticationStart, Failure>
  readonly authCancel: (server: string, id: string) => Effect.Effect<void, Failure>
  readonly resourceServers: Effect.Effect<readonly string[]>
  readonly resources: (server?: string) => Effect.Effect<McpResources.Catalog, Failure>
  readonly resourceFence: (servers: readonly string[]) => Effect.Effect<() => boolean, Failure>
  readonly resourceTemplates: (server?: string) => Effect.Effect<McpResources.Templates, Failure>
  readonly readResource: (server: string, uri: string) => Effect.Effect<McpResources.Read, Failure>
  /** Connect/disconnect save an explicit user choice; retry changes only the current runtime. */
  readonly connect: (server: string) => Effect.Effect<void, Failure>
  readonly disconnect: (server: string) => Effect.Effect<void, Failure>
  readonly retry: (server: string) => Effect.Effect<void, Failure>
  readonly resetPreference: (server: string) => Effect.Effect<void, Failure>
  /** Initial base-server errors are nonfatal; installed candidates remain strict. */
  readonly prepareReload: (initial?: boolean) => Effect.Effect<Prepared, Failure, Scope.Scope>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/v2/MCP") {}

interface Connection {
  readonly client: Client
  readonly timeout: number
  readonly scope: Scope.Closeable
  readonly token: object
  readonly status: Mcp.Status
  readonly healthy: () => boolean
  readonly reconnectable: () => boolean
  readonly verify: () => void
  readonly commit: () => void
}

const close = (scope: Scope.Closeable) => Scope.close(scope, Exit.void)
const failure = (cause: Cause.Cause<unknown>, server?: string) => {
  const error = Cause.squash(cause)
  return error instanceof Failure
    ? error
    : new Failure({
        code: "load",
        server,
        message: "Could not initialize MCP server",
      })
}
const make = Effect.gen(function* () {
  const config = yield* Config.Service
  const location = yield* Location.Service
  const global = yield* Global.Service
  const preferences = McpPreferences.make(location, global.data)
  const events = yield* EventV2.Service
  const bundles = yield* PluginBundleState.Service
  const permission = yield* PermissionV2.Service
  const guard = yield* LocationRuntimeGuard.Service
  const tools = yield* Tools.Service
  const lifetime = yield* Scope.Scope
  // Keep jobs outside individual connection scopes: a successful recovery retires
  // its predecessor, and must never wait for its own worker to stop.
  const connectionsScope = yield* Scope.fork(lifetime, "sequential")
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const runOAuth = yield* FiberSet.makeRuntimePromise<
    never,
    "connected" | "credentials_ready" | "retry_required",
    Failure
  >()
  const jobs = new Map<string, { token: object; fiber: Fiber.Fiber<void> }>()
  const parked = new WeakSet<object>()
  const stopped = { value: false }
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopped.value = true
    }),
  )
  const cancel = (name: string, token: object) =>
    Effect.suspend(() => {
      const job = jobs.get(name)
      return job?.token === token ? Fiber.interrupt(job.fiber).pipe(Effect.asVoid) : Effect.void
    })
  const current: {
    connections: Map<string, Connection>
    status: Map<string, Mcp.Status>
    servers: Record<string, typeof ConfigMCP.Server.Type>
    defaults: ConfigMCP.Timeout
    overrides: Map<string, boolean>
    preferenceError: boolean
  } = {
    connections: new Map(),
    status: new Map(),
    servers: {},
    defaults: {},
    overrides: new Map(),
    preferenceError: false,
  }

  const notify = (server?: string) => {
    if (!stopped.value)
      fork(
        events
          .publish(McpEvent.StatusChanged, server === undefined ? {} : { server }, { location })
          .pipe(Effect.asVoid),
      )
  }
  const setStatus = (name: string, status: Mcp.Status) => {
    current.status.set(name, status)
    notify(name)
  }

  const oauthError = (error: unknown, server?: string) =>
    new Failure({
      code:
        error instanceof McpOAuth.Failure
          ? error.code === "conflict"
            ? "busy"
            : ["cancelled", "expired"].includes(error.code)
              ? "auth"
              : (error.code as "invalid" | "auth" | "storage" | "not_found" | "unsupported" | "load")
          : "load",
      server,
      message: error instanceof McpOAuth.Failure ? error.message : "MCP authentication could not complete",
    })
  const oauth = McpOAuth.make({
    location,
    data: global.data,
    definition: (name) => (Object.hasOwn(current.servers, name) ? current.servers[name] : undefined),
    notify,
    publish: (name, active) =>
      runOAuth(
        guard
          .idle(
            location,
            Effect.scoped(
              Effect.gen(function* () {
                const server = Object.hasOwn(current.servers, name) ? current.servers[name] : undefined
                if (!server || !active())
                  return yield* new Failure({
                    code: "auth",
                    server: name,
                    message: "MCP authentication was superseded",
                  })
                const choices = yield* preferences.read.pipe(
                  Effect.mapError(
                    () =>
                      new Failure({
                        code: "storage",
                        server: name,
                        message: "Could not read saved MCP connection choices",
                      }),
                  ),
                )
                if (!(choices.get(name) ?? !server.disabled)) return "credentials_ready" as const
                const previous = current.connections.get(name)
                const candidate = yield* prepareConnection(name, server, current.defaults)
                return yield* preferences
                  .inspect((latest) =>
                    Effect.sync(() => {
                      if (!active()) throw new McpOAuth.Failure("cancelled")
                      if (!(latest.get(name) ?? !server.disabled)) return "credentials_ready" as const
                      candidate.verify()
                      candidate.commit()
                      current.connections.set(name, candidate)
                      current.overrides = new Map(latest)
                      setStatus(name, candidate.status)
                      return "connected" as const
                    }),
                  )
                  .pipe(
                    Effect.mapError(
                      () =>
                        new Failure({
                          code: "storage",
                          server: name,
                          message: "Could not read saved MCP connection choices",
                        }),
                    ),
                    Effect.ensuring(
                      Effect.suspend(() =>
                        previous && current.connections.get(name) !== previous ? close(previous.scope) : Effect.void,
                      ),
                    ),
                  )
              }),
            ),
          )
          .pipe(Effect.catchTag("LocationRuntimeBusy", () => Effect.succeed("retry_required" as const))),
      ),
  })
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      stopped.value = true
      await oauth.close()
    }),
  )

  const prepareConnection = Effect.fn("MCP.prepareConnection")(function* (
    name: string,
    server: typeof ConfigMCP.Server.Type,
    defaults: ConfigMCP.Timeout,
  ) {
    const ownership = { committed: false, open: true }
    const token = {}
    // Each generation owns its own child scope, so targeting one server never
    // retires a sibling's transport or leaves empty generation parents behind.
    const connection = yield* Effect.acquireRelease(Scope.fork(connectionsScope, "sequential"), (scope) =>
      ownership.committed ? Effect.void : close(scope),
    )
    yield* Scope.addFinalizer(
      connection,
      Effect.sync(() => {
        ownership.open = false
      }),
    )
    return yield* Effect.gen(function* () {
      const { Client } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/index.js"))
      const { ListRootsRequestSchema } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/types.js"))
      const { UnauthorizedError } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/auth.js"))
      const needsAuth = (error: unknown) =>
        (error instanceof McpOAuth.Failure && error.code === "auth") ||
        error instanceof UnauthorizedError ||
        (error instanceof Error && "code" in error && error.code === 401)
      const registration = yield* Scope.fork(connection, "sequential")
      const alive = { value: true }
      const client = yield* Effect.gen(function* () {
        const create = (transport: Transport) =>
          Effect.gen(function* () {
            const client = new Client({ name: "apexo", version: InstallationVersion }, { capabilities: { roots: {} } })
            client.setRequestHandler(ListRootsRequestSchema, async () => ({
              roots: [{ uri: pathToFileURL(location.directory).href }],
            }))
            yield* Effect.addFinalizer(() =>
              Effect.tryPromise(() => client.close()).pipe(
                Effect.timeout("5 seconds"),
                Effect.tapError(() =>
                  Effect.logError("MCP connection cleanup failed", {
                    server: name,
                  }),
                ),
                Effect.orDie,
              ),
            )
            yield* Effect.tryPromise({
              try: (signal) =>
                client.connect(transport, {
                  signal,
                  timeout: server.timeout?.startup ?? defaults.startup ?? 10_000,
                }),
              catch: (error) =>
                new Failure({
                  code: needsAuth(error) ? "auth" : "load",
                  server: name,
                  message: needsAuth(error) ? "MCP server requires authentication" : "Could not connect to MCP server",
                }),
            }).pipe(
              Effect.onExit((exit) =>
                Exit.isFailure(exit)
                  ? Effect.tryPromise(() => client.close()).pipe(Effect.timeout("5 seconds"), Effect.ignore)
                  : Effect.void,
              ),
            )
            return client
          })
        if (server.type === "local") {
          const { McpStdio } = yield* Effect.promise(() => import("./mcp-stdio"))
          if (!server.command.length || !server.command[0]?.trim())
            return yield* new Failure({
              code: "invalid",
              server: name,
              message: "MCP command is empty",
            })
          return yield* create(
            McpStdio.make({
              command: [...server.command],
              cwd: path.resolve(location.directory, server.cwd ?? "."),
              environment: server.environment,
            }),
          )
        }
        const url = URL.canParse(server.url) ? new URL(server.url) : undefined
        if (!url || !["http:", "https:"].includes(url.protocol))
          return yield* new Failure({
            code: "invalid",
            server: name,
            message: "MCP URL must use HTTP or HTTPS",
          })
        const { StreamableHTTPClientTransport } = yield* Effect.promise(
          () => import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
        )
        const { SSEClientTransport } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/sse.js"))
        const options = {
          requestInit: server.headers ? { headers: server.headers } : undefined,
          ...(McpOAuth.supported(server)
            ? {
                fetch: oauth.fetchFor(name, server, () => ownership.open && !stopped.value),
              }
            : {}),
        }
        const first = yield* create(new StreamableHTTPClientTransport(url, options)).pipe(Effect.exit)
        if (Exit.isSuccess(first)) return first.value
        const error = Cause.squash(first.cause)
        if (Cause.hasInterruptsOnly(first.cause)) return yield* Effect.failCause(first.cause)
        if (error instanceof Failure && error.code === "auth") return yield* error
        return yield* create(new SSEClientTransport(url, options))
      }).pipe(Effect.provideService(Scope.Scope, connection))
      client.onclose = () => {
        alive.value = false
        if (!ownership.open || !ownership.committed || current.connections.get(name)?.token !== token) return
        setStatus(name, {
          status: "failed",
          tools: 0,
          error: "MCP connection closed",
        })
        fork(close(registration))
        if (server.type === "local") schedule(name, token)
      }
      const definitions: Awaited<ReturnType<Client["listTools"]>>["tools"] = []
      const cursors = new Set<string>()
      if (client.getServerCapabilities()?.tools) {
        const page = { cursor: undefined as string | undefined }
        do {
          const listed = yield* Effect.tryPromise({
            try: (signal) =>
              client.listTools(page.cursor ? { cursor: page.cursor } : undefined, {
                signal,
                timeout: server.timeout?.request ?? defaults.request ?? 30_000,
              }),
            catch: () =>
              new Failure({
                code: "load",
                server: name,
                message: "Could not list MCP tools",
              }),
          })
          definitions.push(...listed.tools)
          if (definitions.length > 1_000 || (listed.nextCursor && cursors.has(listed.nextCursor)))
            return yield* new Failure({
              code: "invalid",
              server: name,
              message: "MCP tool catalog exceeds its limit or repeats a cursor",
            })
          page.cursor = listed.nextCursor
          if (page.cursor) cursors.add(page.cursor)
        } while (page.cursor)
      }
      const entries = yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            definitions.map((definition) =>
              McpTools.make({
                server: name,
                definition,
                client,
                timeout: server.timeout?.request ?? defaults.request ?? 30_000,
                permission,
                guard,
                location,
                active: () => ownership.committed && current.connections.get(name)?.token === token && alive.value,
              }),
            ),
          ),
        catch: () =>
          new Failure({
            code: "invalid",
            server: name,
            message: "Invalid MCP tool schema",
          }),
      })
      if (new Set(entries.map(([key]) => key)).size !== entries.length)
        return yield* new Failure({
          code: "invalid",
          server: name,
          message: "MCP server advertised duplicate tool names",
        })
      const publish = yield* tools.prepare(Object.fromEntries(entries)).pipe(
        Effect.provideService(Scope.Scope, registration),
        Effect.mapError(
          () =>
            new Failure({
              code: "invalid",
              server: name,
              message: "Invalid MCP tool registration",
            }),
        ),
      )
      yield* Scope.addFinalizer(
        connection,
        Effect.sync(() => {
          ownership.open = false
        }),
      )
      return {
        scope: connection,
        client,
        timeout: server.timeout?.request ?? defaults.request ?? 30_000,
        token,
        status: { status: "connected", tools: entries.length } as Mcp.Status,
        healthy: () => ownership.open && alive.value,
        reconnectable: () => ownership.open && !alive.value,
        verify: () => {
          if (!ownership.open || !alive.value)
            throw new Failure({
              code: "load",
              server: name,
              message: "MCP candidate disconnected before activation",
            })
        },
        commit: () => {
          publish()
          ownership.committed = true
        },
      } satisfies Connection
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close(connection) : Effect.void)))
  })

  const prepareReload = Effect.fn("MCP.prepareReload")(function* (initial = false) {
    const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
    const servers = Object.fromEntries(
      documents.flatMap((document) => Object.entries(document.info.mcp?.servers ?? {})),
    ) as Record<string, typeof ConfigMCP.Server.Type>
    const base = new Set(documents.slice(1).flatMap((document) => Object.keys(document.info.mcp?.servers ?? {})))
    const defaults = documents.reduce<ConfigMCP.Timeout>(
      (value, document) => ({ ...value, ...document.info.mcp?.timeout }),
      {},
    )
    const installed = new Set(Object.keys((yield* bundles.get).config.mcp ?? {}).filter((name) => !base.has(name)))
    const saved = yield* preferences.read.pipe(Effect.exit)
    if (Exit.isFailure(saved) && !initial) {
      current.preferenceError = true
      notify()
      return yield* new Failure({
        code: "storage",
        message: "Could not load saved MCP connection choices",
      })
    }
    const choices = Exit.isSuccess(saved) ? saved.value : new Map<string, boolean>()
    const previous = [...current.connections.entries()]
    const connections = new Map<string, Connection>()
    const statuses = new Map<string, Mcp.Status>()
    for (const [name, server] of Object.entries(servers)) {
      if (Exit.isFailure(saved)) {
        statuses.set(name, {
          status: "failed",
          tools: 0,
          error: "Could not load saved MCP connection choices",
        })
        continue
      }
      const credentials = yield* Effect.tryPromise({
        try: () => oauth.observe(name, server),
        catch: (error) => oauthError(error, name),
      }).pipe(Effect.exit)
      if (Exit.isFailure(credentials)) {
        const error = failure(credentials.cause, name)
        if (!initial || installed.has(name)) return yield* error
        statuses.set(name, {
          status: "failed",
          tools: 0,
          error: error.message,
        })
        continue
      }
      if (!(choices.get(name) ?? !server.disabled)) {
        statuses.set(name, { status: "disabled", tools: 0 })
        continue
      }
      const attempt = yield* prepareConnection(name, server, defaults).pipe(Effect.exit)
      if (Exit.isSuccess(attempt)) {
        connections.set(name, attempt.value)
        statuses.set(name, attempt.value.status)
        continue
      }
      if (Cause.hasInterruptsOnly(attempt.cause)) return yield* Effect.failCause(attempt.cause)
      const error = failure(attempt.cause, name)
      if (!initial || installed.has(name)) return yield* error
      statuses.set(name, {
        status: error.code === "auth" ? "needs_auth" : "failed",
        tools: 0,
        error: error.message,
      })
    }
    return {
      commit: () => {
        for (const connection of connections.values()) connection.verify()
        oauth.supersede()
        for (const connection of connections.values()) connection.commit()
        current.connections = connections
        current.status = statuses
        current.servers = servers
        current.defaults = defaults
        current.overrides = choices
        current.preferenceError = Exit.isFailure(saved)
        notify()
      },
      retire: Effect.forEach(
        previous,
        ([name, connection]) => cancel(name, connection.token).pipe(Effect.andThen(close(connection.scope))),
        { discard: true },
      ),
    }
  })

  const explicitManage = (name: string, operation: "connect" | "disconnect" | "retry" | "resetPreference") =>
    Effect.promise(async () => {
      oauth.supersede(name)
      await oauth.settle(name)
    }).pipe(
      Effect.andThen(Effect.suspend(() => manage(name, operation))),
      Effect.ensuring(Effect.promise(() => oauth.settle(name))),
    )

  const manage = (name: string, operation: "connect" | "disconnect" | "retry" | "resetPreference", expected?: object) =>
    guard
      .idle(
        location,
        Effect.scoped(
          Effect.gen(function* () {
            const server = Object.hasOwn(current.servers, name) ? current.servers[name] : undefined
            if (
              expected &&
              (current.connections.get(name)?.token !== expected ||
                !server ||
                server.type !== "local" ||
                !(current.overrides.get(name) ?? !server.disabled))
            )
              return
            if (!server)
              return yield* new Failure({
                code: "not_found",
                server: name,
                message: "MCP server is not configured in this Location",
              })
            if (!expected) oauth.supersede(name)
            const previous = current.connections.get(name)
            if (expected && previous?.healthy()) return
            const execute = Effect.gen(function* () {
              // An explicit retry cannot bypass unreadable or newly disabled saved choices.
              const choices = expected
                ? current.overrides
                : yield* preferences.read.pipe(
                    Effect.mapError(
                      () =>
                        new Failure({
                          code: "storage",
                          server: name,
                          message: "Could not read saved MCP connection choices",
                        }),
                    ),
                  )
              current.preferenceError = false
              const enabled =
                operation === "connect"
                  ? true
                  : operation === "disconnect"
                    ? false
                    : operation === "resetPreference"
                      ? !server.disabled
                      : (choices.get(name) ?? !server.disabled)
              if (operation === "retry" && !enabled)
                return yield* new Failure({
                  code: "invalid",
                  server: name,
                  message: "MCP server is disabled; use Connect to enable it",
                })
              const candidate =
                enabled && (operation === "retry" || !previous?.healthy())
                  ? yield* prepareConnection(name, server, current.defaults)
                  : undefined
              const publish = (values: ReadonlyMap<string, boolean>) =>
                Effect.sync(() => {
                  if (enabled) (candidate ?? previous)?.verify()
                  candidate?.commit()
                  if (candidate) current.connections.set(name, candidate)
                  if (!enabled) current.connections.delete(name)
                  current.overrides = new Map(values)
                  current.preferenceError = false
                  setStatus(name, enabled ? (candidate?.status ?? previous!.status) : { status: "disabled", tools: 0 })
                })
              const commit =
                operation === "retry"
                  ? preferences
                      .inspect((values) => {
                        if (!(values.get(name) ?? !server.disabled)) {
                          current.overrides = new Map(values)
                          notify(name)
                          return Effect.fail(
                            new Failure({
                              code: "invalid",
                              server: name,
                              message: "MCP server was disabled elsewhere; refresh before connecting",
                            }),
                          )
                        }
                        return publish(values)
                      })
                      .pipe(
                        Effect.mapError((error) =>
                          error instanceof McpPreferences.Failure
                            ? new Failure({
                                code: "storage",
                                server: name,
                                message: error.message,
                              })
                            : error,
                        ),
                      )
                  : preferences.change(name, operation === "resetPreference" ? undefined : enabled, publish).pipe(
                      Effect.mapError(
                        (error) =>
                          new Failure({
                            code: "storage",
                            server: name,
                            message: error.message,
                          }),
                      ),
                    )
              return yield* commit.pipe(
                // Lock acquisition remains cancelable. Once publication happened,
                // retirement must finish even if the caller was interrupted.
                Effect.ensuring(
                  Effect.suspend(() =>
                    previous && current.connections.get(name) !== previous ? close(previous.scope) : Effect.void,
                  ),
                ),
                Effect.asVoid,
              )
            })
            if (expected || !previous) return yield* execute
            // An admitted explicit action supersedes automatic recovery. A failed
            // retry of a healthy transport retains its future recovery eligibility.
            return yield* Effect.acquireUseRelease(
              Effect.sync(() => parked.add(previous.token)),
              () => cancel(name, previous.token).pipe(Effect.andThen(execute)),
              () =>
                Effect.sync(() => {
                  if (current.connections.get(name)?.token === previous.token && previous.healthy())
                    parked.delete(previous.token)
                }),
            )
          }),
        ).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
            const error = failure(cause, name)
            if (error.code === "storage") {
              current.preferenceError = true
              notify(name)
            }
            // A failed replacement must not relabel the retained working generation.
            if (
              Object.hasOwn(current.servers, name) &&
              !current.connections.get(name)?.healthy() &&
              !(error.code === "invalid" && current.status.get(name)?.status === "disabled")
            )
              setStatus(name, {
                status: error.code === "auth" ? "needs_auth" : "failed",
                tools: 0,
                error: error.message,
              })
            return Effect.fail(error)
          }),
        ),
      )
      .pipe(
        Effect.catchTag("LocationRuntimeBusy", () =>
          Effect.fail(
            new Failure({
              code: "busy",
              server: name,
              message: "Wait for active work in this Location before changing MCP connections",
            }),
          ),
        ),
      )

  const eligible = (name: string, token: object) => {
    const server = Object.hasOwn(current.servers, name) ? current.servers[name] : undefined
    const connection = current.connections.get(name)
    return (
      !stopped.value &&
      !parked.has(token) &&
      server?.type === "local" &&
      (current.overrides.get(name) ?? !server.disabled) &&
      connection?.token === token &&
      connection.reconnectable()
    )
  }
  const schedule = (name: string, token: object) => {
    if (!eligible(name, token) || jobs.has(name)) return
    const recovery = Effect.gen(function* () {
      for (const delay of ["1 second", "4 seconds", "16 seconds"] as const) {
        yield* Effect.sleep(delay)
        while (eligible(name, token)) {
          const attempt = yield* manage(name, "retry", token).pipe(Effect.exit)
          if (Exit.isSuccess(attempt) || Cause.hasInterruptsOnly(attempt.cause)) return
          const error = Cause.squash(attempt.cause)
          if (error instanceof Failure && error.code === "busy") {
            yield* Effect.sleep("100 millis")
            continue
          }
          break
        }
        if (!eligible(name, token)) return
      }
      if (eligible(name, token)) {
        parked.add(token)
        setStatus(name, {
          status: "failed",
          tools: 0,
          error: "MCP automatic reconnect exhausted after 3 attempts; use Retry to reconnect",
        })
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logError("MCP automatic reconnect failed", { server: name }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (jobs.get(name)?.token === token) jobs.delete(name)
          const replacement = current.connections.get(name)
          if (replacement && replacement.token !== token) schedule(name, replacement.token)
        }),
      ),
    )
    jobs.set(name, { token, fiber: fork(recovery) })
  }

  const resourceServers = Effect.sync(() =>
    [...current.connections]
      .filter(([, connection]) => connection.healthy() && connection.client.getServerCapabilities()?.resources)
      .map(([name]) => name)
      .sort(),
  )
  const resourceConnection = (name: string) =>
    Effect.gen(function* () {
      if (!Object.hasOwn(current.servers, name))
        return yield* new Failure({
          code: "not_found",
          server: name,
          message: "MCP resource server is not configured",
        })
      const connection = current.connections.get(name)
      if (!connection?.healthy())
        return yield* new Failure({
          code: current.status.get(name)?.status === "needs_auth" ? "auth" : "load",
          server: name,
          message: "MCP resource server is not connected",
        })
      if (!connection.client.getServerCapabilities()?.resources)
        return yield* new Failure({
          code: "unsupported",
          server: name,
          message: "MCP server does not support resources",
        })
      return connection
    })
  const resourceCatalog = (kind: "resources" | "templates", server?: string) =>
    guard.use(
      location,
      Effect.gen(function* () {
        const names = server === undefined ? yield* resourceServers : [server]
        const collected: Array<McpResources.Resource | McpResources.Template> = []
        const errors: McpResources.CatalogError[] = []
        const snapshots = new Map<string, Connection>()
        for (const name of names) {
          const result = yield* Effect.gen(function* () {
            const connection = yield* resourceConnection(name)
            const listed = yield* Effect.tryPromise({
              try: (signal) => McpResources.catalog(connection.client, kind, connection.timeout, signal),
              catch: (error) =>
                new Failure({
                  code: error instanceof McpResources.Invalid ? "invalid" : "load",
                  server: name,
                  message: error instanceof McpResources.Invalid ? error.message : "Could not list MCP resources",
                }),
            })
            if (current.connections.get(name)?.token !== connection.token || !connection.healthy())
              return yield* new Failure({
                code: "load",
                server: name,
                message: "MCP resource connection changed during catalog request",
              })
            snapshots.set(name, connection)
            return listed
          }).pipe(Effect.exit)
          if (Exit.isFailure(result)) {
            if (Cause.hasInterruptsOnly(result.cause)) return yield* Effect.failCause(result.cause)
            const error = failure(result.cause, name)
            if (server !== undefined) return yield* error
            errors.push({
              server: name,
              code: error.code,
              message: error.message,
            })
            continue
          }
          collected.push(...result.value.map((item) => ({ ...item, server: name })))
          if (
            collected.length > McpResources.MAX_ITEMS ||
            Buffer.byteLength(JSON.stringify(collected)) > McpResources.MAX_CATALOG_BYTES
          )
            return yield* new Failure({
              code: "invalid",
              message: "Combined MCP resource catalog exceeds its limit",
            })
        }
        // Earlier catalogs may close while a later server is still responding.
        const stale = new Set(
          [...snapshots]
            .filter(
              ([name, connection]) =>
                current.connections.get(name)?.token !== connection.token || !connection.healthy(),
            )
            .map(([name]) => name),
        )
        if (server !== undefined && stale.has(server))
          return yield* new Failure({
            code: "load",
            server,
            message: "MCP resource connection changed during catalog request",
          })
        for (const name of stale)
          errors.push({
            server: name,
            code: "load",
            message: "MCP resource connection changed during catalog request",
          })
        return {
          collected: collected.filter((item) => !stale.has(item.server)),
          errors,
        }
      }),
    )
  const readResource = (server: string, uri: string) =>
    guard.use(
      location,
      Effect.gen(function* () {
        const connection = yield* resourceConnection(server)
        const result = yield* Effect.tryPromise({
          try: (signal) => McpResources.read(connection.client, uri, connection.timeout, signal),
          catch: (error) =>
            new Failure({
              code: error instanceof McpResources.Invalid ? "invalid" : "load",
              server,
              message: error instanceof McpResources.Invalid ? error.message : "Could not read MCP resource",
            }),
        })
        if (current.connections.get(server)?.token !== connection.token || !connection.healthy())
          return yield* new Failure({
            code: "load",
            server,
            message: "MCP resource connection changed during read",
          })
        return result
      }),
    )

  return Service.of({
    resourceServers,
    resourceFence: (servers) =>
      Effect.gen(function* () {
        const connections = yield* Effect.forEach(servers, (server) =>
          Effect.map(resourceConnection(server), (connection) => ({ server, connection })),
        )
        return () =>
          connections.every(
            ({ server, connection }) =>
              current.connections.get(server)?.token === connection.token && connection.healthy(),
          )
      }),
    resources: (server) =>
      resourceCatalog("resources", server).pipe(
        Effect.map((result) => ({
          resources: result.collected.filter((item): item is McpResources.Resource => "uri" in item),
          errors: result.errors,
        })),
      ),
    resourceTemplates: (server) =>
      resourceCatalog("templates", server).pipe(
        Effect.map((result) => ({
          resourceTemplates: result.collected.filter((item): item is McpResources.Template => "uriTemplate" in item),
          errors: result.errors,
        })),
      ),
    readResource,
    status: Effect.sync(() =>
      Object.fromEntries(
        [...current.status].map(([name, status]) => [
          name,
          {
            ...status,
            ...(current.servers[name]?.type === "remote"
              ? { authentication: oauth.status(name, current.servers[name]) }
              : {}),
            configuredEnabled: !current.servers[name]?.disabled,
            ...(current.overrides.has(name) ? { preference: current.overrides.get(name) } : {}),
            ...(current.preferenceError ? { preferenceError: true } : {}),
          },
        ]),
      ),
    ),
    prepareReload,
    authStart: (name) =>
      guard
        .idle(
          location,
          Effect.tryPromise({
            try: (signal) => oauth.start(name, signal),
            catch: (error) => oauthError(error, name),
          }),
        )
        .pipe(
          Effect.catchTag("LocationRuntimeBusy", () =>
            Effect.fail(
              new Failure({
                code: "busy",
                server: name,
                message: "Wait for active work before starting authentication",
              }),
            ),
          ),
        ),
    authCancel: (name, id) =>
      Effect.tryPromise({
        try: () => oauth.cancel(name, id),
        catch: (error) => oauthError(error, name),
      }),
    connect: (name) => explicitManage(name, "connect"),
    disconnect: (name) => explicitManage(name, "disconnect"),
    retry: (name) => explicitManage(name, "retry"),
    resetPreference: (name) => explicitManage(name, "resetPreference"),
  })
})
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    Config.node,
    Global.node,
    EventV2.node,
    Location.node,
    PluginBundleState.node,
    PermissionV2.node,
    LocationRuntimeGuard.node,
    ToolRegistry.toolsNode,
  ],
})
