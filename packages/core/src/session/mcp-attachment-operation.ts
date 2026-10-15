export * as SessionMcpAttachmentOperation from "./mcp-attachment-operation"

import { randomBytes } from "node:crypto"
import { McpAttachmentOperation } from "@apexo/schema/mcp-attachment-operation"
import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { LocationServiceMap } from "../location-service-map"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMcpAttachment } from "./mcp-attachment"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionLifecycle } from "./lifecycle"
import { SessionIncarnation } from "./incarnation"

export const LIFETIME_MS = 5 * 60 * 1000
const MAX_ENTRIES = 64
const MAX_SESSION_ENTRIES = 8
const MAX_ACTIVE = 4
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
export interface Interface {
  readonly reserve: (
    sessionID: SessionSchema.ID,
    request: McpAttachmentOperation.Request,
  ) => Effect.Effect<McpAttachmentOperation.Operation, McpAttachmentOperation.Failure>
  readonly execute: (
    sessionID: SessionSchema.ID,
    id: McpAttachmentOperation.OperationID,
    request: McpAttachmentOperation.Request,
  ) => Effect.Effect<McpAttachmentOperation.Operation, McpAttachmentOperation.Failure>
  readonly status: (
    sessionID: SessionSchema.ID,
    id: McpAttachmentOperation.OperationID,
  ) => Effect.Effect<McpAttachmentOperation.Operation, McpAttachmentOperation.Failure>
  readonly cancel: (
    sessionID: SessionSchema.ID,
    id: McpAttachmentOperation.OperationID,
  ) => Effect.Effect<McpAttachmentOperation.Operation, McpAttachmentOperation.Failure>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMcpAttachmentOperation") {}
interface Entry {
  readonly sessionID: SessionSchema.ID
  readonly claim: SessionLifecycle.Claim
  readonly created: string
  readonly agent: SessionSchema.Info["agent"]
  readonly location: string
  readonly request: McpAttachmentOperation.Request
  readonly canonical: string
  readonly done: Deferred.Deferred<McpAttachmentOperation.Operation>
  result: McpAttachmentOperation.Operation
  bytes: number
  authority?: { readonly read: Effect.Effect<string, McpAttachmentOperation.Failure>; readonly fingerprint: string }
  fiber?: Fiber.Fiber<void>
  release: () => void
}

const make = Effect.gen(function* () {
  const snapshots = yield* SessionMcpAttachment.Service
  const sessions = yield* SessionStore.Service
  const lifecycle = yield* SessionLifecycle.Service
  const database = yield* Database.Service
  const locations = yield* LocationServiceMap.Service
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const entries = new Map<McpAttachmentOperation.OperationID, Entry>()
  const finish = (entry: Entry, result: McpAttachmentOperation.Operation) => {
    if (entry.result.status !== "running" && entry.result.status !== "reserved") return
    const bounded = result.error
      ? { ...result, error: { code: result.error.code.slice(0, 64), message: result.error.message.slice(0, 1024) } }
      : result
    const bytes = Buffer.byteLength(JSON.stringify(bounded))
    const retained = [...entries.values()].reduce((total, item) => total + item.bytes, 0)
    entry.result =
      result.status === "completed" && retained + bytes > MAX_SNAPSHOT_BYTES
        ? {
            id: result.id,
            kind: result.kind,
            status: "failed",
            expiresAt: result.expiresAt,
            error: { code: "limit", message: "MCP attachment snapshot capacity is full" },
          }
        : bounded
    entry.bytes = Buffer.byteLength(JSON.stringify(entry.result))
    Deferred.doneUnsafe(entry.done, Effect.succeed(entry.result))
  }
  const stop = (entry: Entry) =>
    Effect.gen(function* () {
      finish(entry, {
        id: entry.result.id,
        kind: entry.result.kind,
        status: "cancelled",
        expiresAt: entry.result.expiresAt,
      })
      if (entry.fiber) yield* Fiber.interrupt(entry.fiber)
    })
  const remove = (entry: Entry) =>
    stop(entry).pipe(
      Effect.andThen(
        Effect.sync(() => {
          entries.delete(entry.result.id)
          entry.release()
          entry.bytes = 0
        }),
      ),
    )
  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    yield* Effect.forEach(
      [...entries.values()].filter((entry) => entry.result.expiresAt <= now),
      remove,
      { concurrency: "unbounded", discard: true },
    )
  })
  yield* Effect.forever(Effect.sleep("30 seconds").pipe(Effect.andThen(sweep))).pipe(Effect.forkScoped)
  const boundary = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof McpAttachmentOperation.Failure
          ? error
          : new McpAttachmentOperation.Failure({
              code: "changed",
              message: "MCP attachment Session ownership changed",
            }),
      ),
    )
  const requireEntry = (sessionID: SessionSchema.ID, id: McpAttachmentOperation.OperationID) =>
    Effect.gen(function* () {
      const entry = entries.get(id)
      if (!entry || entry.sessionID !== sessionID)
        return yield* new McpAttachmentOperation.Failure({
          code: "expired",
          message: "MCP attachment operation is unavailable or expired",
        })
      if (entry.result.expiresAt <= (yield* Clock.currentTimeMillis)) {
        yield* remove(entry)
        return yield* new McpAttachmentOperation.Failure({
          code: "expired",
          message: "MCP attachment operation expired",
        })
      }
      const session = yield* sessions.get(sessionID)
      if (
        !session ||
        !lifecycle.available(entry.claim) ||
        JSON.stringify(session.location) !== entry.location ||
        (yield* SessionIncarnation.created(database.db, sessionID)) !== entry.created
      )
        return yield* new McpAttachmentOperation.Failure({
          code: "changed",
          message: "MCP attachment operation belongs to a retired Session",
        })
      return entry
    })
  const result = (entry: Entry) =>
    lifecycle.owned(
      entry.claim,
      lifecycle.use(
        entry.sessionID,
        Effect.gen(function* () {
          yield* requireEntry(entry.sessionID, entry.result.id)
          const current = yield* sessions.get(entry.sessionID)
          if (current?.agent !== entry.agent)
            return yield* new McpAttachmentOperation.Failure({
              code: "changed",
              message: "Session agent changed since attachment reservation",
            })
          if (
            entry.result.status === "completed" &&
            (!entry.authority || (yield* entry.authority.read) !== entry.authority.fingerprint)
          )
            return yield* new McpAttachmentOperation.Failure({
              code: "denied",
              message: "Session read authority changed since attachment preparation",
            })
          return structuredClone(entry.result)
        }),
      ),
    )
  return Service.of({
    reserve: (sessionID, input) =>
      boundary(
        lifecycle.use(
          sessionID,
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(McpAttachmentOperation.Request)(input).pipe(
              Effect.mapError(
                () =>
                  new McpAttachmentOperation.Failure({ code: "invalid", message: "Invalid MCP attachment request" }),
              ),
            )
            const canonical = JSON.stringify(canonicalValue(request))
            if (Buffer.byteLength(canonical) > 65_536)
              return yield* new McpAttachmentOperation.Failure({
                code: "limit",
                message: "MCP attachment request exceeds its limit",
              })
            const session = yield* sessions.get(sessionID)
            const created = yield* SessionIncarnation.created(database.db, sessionID)
            if (!session || !created)
              return yield* new McpAttachmentOperation.Failure({ code: "missing", message: "Session not found" })
            // No Location lookup, permission prompt, MCP connection or model work occurs during reservation.
            if (
              entries.size >= MAX_ENTRIES ||
              [...entries.values()].filter((entry) => entry.sessionID === sessionID).length >= MAX_SESSION_ENTRIES
            )
              return yield* new McpAttachmentOperation.Failure({
                code: "limit",
                message: "MCP attachment operation capacity is full",
              })
            const entry: Entry = {
              sessionID,
              claim: yield* lifecycle.capture(sessionID),
              created,
              agent: session.agent,
              location: JSON.stringify(session.location),
              request: structuredClone(request),
              canonical,
              done: Deferred.makeUnsafe(),
              bytes: 0,
              release: () => {},
              result: {
                id: McpAttachmentOperation.OperationID.make(`maop_${randomBytes(16).toString("hex")}`),
                kind: request.kind,
                status: "reserved",
                expiresAt: (yield* Clock.currentTimeMillis) + LIFETIME_MS,
              },
            }
            entry.release = yield* lifecycle.register(entry.claim, entry, remove(entry))
            entries.set(entry.result.id, entry)
            return structuredClone(entry.result)
          }),
        ),
      ),
    execute: (sessionID, id, request) =>
      boundary(
        Effect.gen(function* () {
          const entry = yield* requireEntry(sessionID, id)
          if (JSON.stringify(canonicalValue(request)) !== entry.canonical)
            return yield* new McpAttachmentOperation.Failure({
              code: "conflict",
              message: "MCP attachment operation input does not match its reservation",
            })
          if (entry.result.status === "reserved") {
            const current = yield* sessions.get(sessionID)
            if (current?.agent !== entry.agent)
              return yield* new McpAttachmentOperation.Failure({
                code: "changed",
                message: "Session agent changed since attachment reservation",
              })
            if ([...entries.values()].filter((item) => item.result.status === "running").length >= MAX_ACTIVE)
              return yield* new McpAttachmentOperation.Failure({
                code: "limit",
                message: "Too many active MCP attachment operations",
              })
            // No yield between the start claim and publication of its concrete fiber.
            entry.result = { ...entry.result, status: "running" }
            entry.fiber = fork(
              lifecycle.owned(
                entry.claim,
                Effect.gen(function* () {
                  const result = yield* Effect.gen(function* () {
                    const current = yield* sessions.get(sessionID)
                    if (!current || current.agent !== entry.agent)
                      return yield* new McpAttachmentOperation.Failure({
                        code: "changed",
                        message: "Session agent changed since attachment reservation",
                      })
                    const read = yield* Effect.gen(function* () {
                      const permission = yield* PermissionV2.Service
                      return permission.capture(sessionID, entry.agent).pipe(
                        Effect.flatMap((authority) => {
                          const fingerprint = JSON.stringify(authority)
                          return Buffer.byteLength(fingerprint) > 262_144
                            ? Effect.fail(
                                new McpAttachmentOperation.Failure({
                                  code: "limit",
                                  message: "Attachment authority snapshot exceeds its limit",
                                }),
                              )
                            : Effect.succeed(fingerprint)
                        }),
                        Effect.mapError(
                          () =>
                            new McpAttachmentOperation.Failure({
                              code: "changed",
                              message: "Session authority is unavailable",
                            }),
                        ),
                      )
                    }).pipe(Effect.provide(locations.get(current.location)))
                    entry.authority = { read, fingerprint: yield* read }

                    if (entry.request.kind === "catalog")
                      return { catalog: yield* snapshots.catalog(sessionID, entry.request.input) }
                    return { prepared: yield* snapshots.prepare(sessionID, entry.request.input) }
                  }).pipe(Effect.exit)
                  if (Exit.isSuccess(result)) {
                    if (!entry.authority || (yield* entry.authority.read) !== entry.authority.fingerprint) {
                      finish(entry, {
                        id,
                        kind: entry.result.kind,
                        expiresAt: entry.result.expiresAt,
                        status: "failed",
                        error: { code: "denied", message: "Session authority changed while preparing attachments" },
                      })
                      return
                    }
                    finish(entry, { ...entry.result, ...result.value, status: "completed" })
                    return
                  }
                  const cause = Cause.squash(result.cause)
                  const error =
                    cause instanceof McpAttachmentOperation.Failure
                      ? { code: cause.code, message: cause.message }
                      : Cause.hasInterrupts(result.cause)
                        ? { code: "cancelled", message: "MCP attachment operation cancelled" }
                        : { code: "unavailable", message: "MCP attachment operation failed" }
                  finish(entry, {
                    id,
                    kind: entry.result.kind,
                    expiresAt: entry.result.expiresAt,
                    status: Cause.hasInterrupts(result.cause) ? "cancelled" : "failed",
                    error,
                  })
                }).pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() =>
                      finish(entry, {
                        id,
                        kind: entry.result.kind,
                        expiresAt: entry.result.expiresAt,
                        status: "cancelled",
                      }),
                    ),
                  ),
                  Effect.catchCause(() =>
                    Effect.sync(() =>
                      finish(entry, {
                        id,
                        kind: entry.result.kind,
                        expiresAt: entry.result.expiresAt,
                        status: "failed",
                        error: { code: "unavailable", message: "MCP attachment operation failed" },
                      }),
                    ),
                  ),
                ),
              ),
            )
          }
          yield* Deferred.await(entry.done)
          return yield* result(entry)
        }),
      ),
    status: (sessionID, id) =>
      boundary(
        Effect.gen(function* () {
          const entry = yield* requireEntry(sessionID, id)
          return yield* result(entry)
        }),
      ),
    cancel: (sessionID, id) =>
      boundary(
        Effect.gen(function* () {
          const entry = yield* requireEntry(sessionID, id)
          yield* stop(entry)
          yield* requireEntry(sessionID, id)
          return {
            id: entry.result.id,
            kind: entry.result.kind,
            status: entry.result.status,
            expiresAt: entry.result.expiresAt,
            error: entry.result.error,
          }
        }),
      ),
  })
})
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    )
  return value
}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionMcpAttachment.node, SessionStore.node, SessionLifecycle.node, Database.node, LocationServiceMap.node],
})
