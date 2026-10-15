export * as MemoryNative from "./memory-native"

import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { MemoryNote } from "@apexo/schema/memory-note"
import { SessionID } from "@apexo/schema/session-id"
import { Config } from "./config"
import { makeLocationNode } from "./effect/app-node"
import { Global } from "./global"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { MemoryCatalog } from "./memory-catalog"
import { MemoryMaintenance } from "./memory-maintenance"
import { MemorySearch } from "./memory-search"
import { MemoryV2 } from "./memory-v2"
import { MemoryV2Catalog } from "./memory-v2-catalog"
import { PermissionV2 } from "./permission"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionManagedChild } from "./session/managed-child"
import { SessionMemoryModeNative } from "./session/memory-mode-native"
import { SessionStore } from "./session/store"
import { Tool } from "./tool/tool"
import { ToolRegistry } from "./tool/registry"
import { WorkspaceMemory } from "./workspace-memory"

export const Failure = SessionMemoryModeNative.Failure
export type Failure = SessionMemoryModeNative.Failure
export type SearchInput = Parameters<MemorySearch.Interface["search"]>[0]
export type GetInput = Parameters<MemorySearch.Interface["get"]>[0]
export type SearchOutput = Effect.Success<ReturnType<MemorySearch.Interface["search"]>>
export type GetOutput = Effect.Success<ReturnType<MemorySearch.Interface["get"]>>
export type NoteInput = { operation: "read" | "remember"; content?: string; scope?: "global" | "workspace" }
export interface Interface {
  readonly status: (id: SessionID, busy?: boolean) => Effect.Effect<SessionMemoryModeNative.Snapshot, Failure>
  readonly toggle: (
    id: SessionID,
    enabled: boolean,
    busy?: boolean,
  ) => Effect.Effect<SessionMemoryModeNative.Snapshot, Failure>
  readonly list: (id: SessionID, query?: string) => Effect.Effect<MemoryNote.Summary[], Failure>
  readonly preview: (id: SessionID, file: string) => Effect.Effect<MemoryNote.Detail, Failure>
  readonly forget: (id: SessionID, input: MemoryNote.Forget) => Effect.Effect<boolean, Failure>
  readonly materialize: (
    id: SessionID,
    input: ToolRegistry.Materialization,
  ) => Effect.Effect<ToolRegistry.Materialization, Failure>
  readonly search: (input: SearchInput, context: Tool.Context) => Effect.Effect<SearchOutput, Failure>
  readonly get: (input: GetInput, context: Tool.Context) => Effect.Effect<GetOutput, Failure>
  readonly note: (input: NoteInput, context: Tool.Context) => Effect.Effect<{ path: string; content: string }, Failure>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/MemoryNative") {}
const failure = (error: unknown) =>
  error instanceof Failure
    ? error
    : error instanceof WorkspaceMemory.MigrationRequired
      ? new Failure({ code: "unsupported", message: error.message })
      : error instanceof SessionManagedChild.Failure
        ? new Failure({
            code: error.code === "stale" ? "changed" : error.code === "missing" ? "missing" : "storage",
            message: error.message,
          })
        : error instanceof SessionLifecycle.Closed
          ? new Failure({ code: "missing", message: "Session no longer exists" })
          : error instanceof MemoryCatalog.Error
            ? new Failure({
                code:
                  error.reason === "not_found"
                    ? "missing"
                    : error.reason === "changed"
                      ? "changed"
                      : error.reason === "forbidden"
                        ? "forbidden"
                        : "storage",
                message: error.message,
              })
            : new Failure({ code: "storage", message: "Memory operation could not be completed" })
// These promises do local, bounded storage work. Join them before releasing the incarnation;
// interrupting an Effect wrapper must not leave a filesystem mutation running after deletion.
const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: failure }).pipe(Effect.uninterruptible)
const names = new Set(["memory", "memory_search", "memory_get"])
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const lifecycle = yield* SessionLifecycle.Service
    const sessions = yield* SessionStore.Service
    const managed = yield* SessionManagedChild.Service
    const mode = yield* SessionMemoryModeNative.Service
    const permission = yield* PermissionV2.Service
    const mutation = yield* LocationMutation.Service
    const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
    const settings: SessionMemoryModeNative.Settings = {
      memory: documents.reduce((value, entry) => ({ ...value, ...entry.info.memory }), {}),
      memory_v2: documents.reduce((value, entry) => ({ ...value, ...entry.info.memory_v2 }), {}),
    }
    const placement = Effect.fn("MemoryNative.placement")(function* (id: SessionID) {
      const session = yield* sessions.get(id)
      if (
        !session ||
        session.location.directory !== location.directory ||
        session.location.workspaceID !== location.workspaceID
      )
        return yield* new Failure({ code: "missing", message: "Session not found in this Location" })
      return session
    })
    const publicAccess = Effect.fn("MemoryNative.publicAccess")(function* (id: SessionID) {
      yield* placement(id)
      if (yield* managed.managed(id))
        return yield* new Failure({
          code: "unsupported",
          message: "Manage Memory from the ordinary parent Session; managed children require their live owner",
        })
    })
    const enabled = Effect.fn("MemoryNative.enabled")(function* (id: SessionID, legacy = false) {
      yield* placement(id)
      const snapshot = yield* mode.get(id, settings)
      if (!snapshot.info.enabled)
        return yield* new Failure({ code: "disabled", message: "Memory is disabled for this Session" })
      if (legacy && snapshot.backend !== "legacy")
        return yield* new Failure({
          code: "unsupported",
          message: "Memory V2 uses its curated filesystem context and ordinary file tools",
        })
      return snapshot
    })
    const resource = (file: string) => {
      const relative = path.relative(location.directory, file)
      return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative || "."
    }
    const catalog = Effect.fn("MemoryNative.catalog")(function* (id: SessionID, context?: Tool.Context) {
      const inspect = yield* permission.inspect(id, context?.agent)
      const snapshot = yield* mode.get(id, settings)
      const roots = (["global", "workspace"] as const).map((scope) =>
        snapshot.backend === "v2"
          ? MemoryV2.directory({
              directory: location.directory,
              home: global.home,
              projectID: location.project.id,
              scope,
            })
          : path.dirname(
              WorkspaceMemory.file(location.directory, global.home, { projectID: location.project.id, scope }),
            ),
      )
      const scopes = yield* Effect.forEach(roots, (root) => mutation.resolve({ path: root, kind: "directory" }))
      const allowed = scopes.map(
        (target) =>
          !target.externalDirectory || inspect("external_directory", [target.externalDirectory.resource]) === "allow",
      )
      return {
        directory: location.directory,
        home: global.home,
        projectID: location.project.id,
        compactIndex: settings.memory_v2?.compact_index_enabled,
        migrate: false,
        permitted: (files: readonly string[], action: "read" | "edit") =>
          files.every((file) => {
            // Workspace roots can be nested beneath the global root; the specific scope owns its authorization.
            const index = scopes.findLastIndex(
              (scope, index) =>
                file === scope.canonical ||
                file.startsWith(scope.canonical + path.sep) ||
                file === roots[index] ||
                file.startsWith(roots[index] + path.sep),
            )
            return index !== -1 && allowed[index] && inspect(action, [resource(file), file]) === "allow"
          }),
      }
    })
    const ask = Effect.fn("MemoryNative.ask")(function* (
      context: Tool.Context,
      action: string,
      files: readonly string[],
    ) {
      const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
      for (const file of files) {
        const target = yield* mutation.resolve({ path: file, kind: "file" })
        if (target.externalDirectory)
          yield* permission.assert({
            ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
        yield* permission.assert({
          action,
          resources: [target.resource, file],
          save: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
      }
    })
    const invoke = <A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>) =>
      lifecycle.run(id, work).pipe(Effect.mapError(failure))
    const passive = <A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>) =>
      invoke(
        id,
        Effect.gen(function* () {
          yield* publicAccess(id)
          return yield* work
        }),
      )
    return Service.of({
      status: (id, busy = false) =>
        passive(id, mode.get(id, settings).pipe(Effect.map((value) => ({ ...value, info: { ...value.info, busy } })))),
      toggle: (id, value, busy = false) =>
        passive(
          id,
          mode
            .set(id, settings, value, busy)
            .pipe(Effect.map((snapshot) => ({ ...snapshot, info: { ...snapshot.info, busy } }))),
        ),
      list: (id, query) =>
        passive(
          id,
          Effect.gen(function* () {
            const snapshot = yield* enabled(id)
            const input = yield* catalog(id)
            const result =
              snapshot.backend === "v2"
                ? yield* MemoryV2Catalog.list(input, query)
                : yield* io(() => MemoryCatalog.list(input, query))
            return yield* mode.commit(id, settings, snapshot.revision, Effect.succeed(result))
          }),
        ),
      preview: (id, file) =>
        passive(
          id,
          Effect.gen(function* () {
            const snapshot = yield* enabled(id)
            const input = yield* catalog(id)
            const result =
              snapshot.backend === "v2"
                ? yield* MemoryV2Catalog.preview(input, file)
                : yield* io(() => MemoryCatalog.preview(input, file))
            return yield* mode.commit(id, settings, snapshot.revision, Effect.succeed(result))
          }),
        ),
      forget: (id, note) =>
        passive(
          id,
          Effect.gen(function* () {
            const snapshot = yield* enabled(id)
            const input = yield* catalog(id)
            return yield* mode.commit(
              id,
              settings,
              snapshot.revision,
              Effect.gen(function* () {
                if (snapshot.backend === "v2") return yield* MemoryV2Catalog.forget(input, note)
                return yield* io(() => MemoryCatalog.forget(input, note))
              }),
            )
          }),
        ),
      materialize: (id, input) =>
        invoke(
          id,
          Effect.gen(function* () {
            const snapshot = yield* mode.get(id, settings)
            if (snapshot.info.enabled && snapshot.backend === "legacy") return input
            return {
              definitions: input.definitions.filter((definition) => !names.has(definition.name)),
              settle: (request) =>
                names.has(request.call.name)
                  ? Effect.succeed({
                      result: { type: "error" as const, value: "Memory tools are unavailable for this Session" },
                    })
                  : input.settle(request),
            }
          }),
        ),
      search: (input, context) =>
        invoke(
          context.sessionID,
          Effect.gen(function* () {
            const snapshot = yield* enabled(context.sessionID, true)
            const roots = ["global", "workspace"].map((scope) =>
              WorkspaceMemory.file(location.directory, global.home, {
                projectID: location.project.id,
                scope: scope as "global" | "workspace",
              }),
            )
            yield* ask(context, "memory_search", roots)
            const search = yield* MemorySearch.make({
              directory: location.directory,
              projectID: location.project.id,
              home: global.home,
              search: settings.memory?.search,
              watch: false,
              joinIO: true,
            })
            const result = yield* search.search(input, (files) =>
              ask(context, "read", search.accessPaths(files)).pipe(
                Effect.mapError(() => new MemorySearch.MemoryError({ message: "Memory read is not permitted" })),
              ),
            )
            return yield* mode.commit(context.sessionID, settings, snapshot.revision, Effect.succeed(result))
          }).pipe(Effect.scoped),
        ),
      get: (input, context) =>
        invoke(
          context.sessionID,
          Effect.gen(function* () {
            const snapshot = yield* enabled(context.sessionID, true)
            const search = yield* MemorySearch.make({
              directory: location.directory,
              projectID: location.project.id,
              home: global.home,
              watch: false,
              joinIO: true,
            })
            const file = yield* search.resolve(input.path)
            yield* ask(context, "memory_get", [file])
            yield* ask(context, "read", search.accessPaths([file]))
            const result = yield* search.get(input)
            return yield* mode.commit(context.sessionID, settings, snapshot.revision, Effect.succeed(result))
          }).pipe(Effect.scoped),
        ),
      note: (input, context) =>
        invoke(
          context.sessionID,
          Effect.gen(function* () {
            const snapshot = yield* enabled(context.sessionID, true)
            const selected = { projectID: location.project.id, scope: input.scope ?? "workspace" }
            const file = WorkspaceMemory.file(location.directory, global.home, selected)
            const generation = yield* io(() =>
              MemoryMaintenance.revision(WorkspaceMemory.maintenance(location.directory, global.home, selected)),
            )
            yield* ask(context, "memory", [file])
            yield* ask(context, "read", [file])
            if (input.operation === "read") {
              const selection = yield* catalog(context.sessionID, context)
              const note = yield* io(() => MemoryCatalog.preview(selection, file))
              return yield* mode.commit(
                context.sessionID,
                settings,
                snapshot.revision,
                Effect.succeed({ path: file, content: note.content }),
              )
            }
            if (!input.content?.trim() || Buffer.byteLength(input.content) > 32 * 1024)
              return yield* new Failure({ code: "invalid", message: "A memory note must contain 1–32768 UTF-8 bytes" })
            yield* ask(context, "edit", [file])
            const content = input.content
            return yield* mode.commit(
              context.sessionID,
              settings,
              snapshot.revision,
              Effect.gen(function* () {
                const result = yield* io(() =>
                  WorkspaceMemory.update(
                    location.directory,
                    { operation: "remember", content, scope: selected.scope },
                    global.home,
                    selected,
                    { generation, migrate: false },
                  ),
                )
                return { path: file, content: result }
              }),
            )
          }),
        ),
    })
  }),
)
export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Config.node,
    Global.node,
    Location.node,
    SessionLifecycle.node,
    SessionStore.node,
    SessionManagedChild.node,
    SessionMemoryModeNative.node,
    PermissionV2.node,
    LocationMutation.node,
  ],
})
