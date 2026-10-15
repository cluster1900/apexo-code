export * as SessionMcpAttachment from "./mcp-attachment"

import { SessionMcpAttachment } from "@apexo/schema/session-mcp-attachment"
import { Context, Effect, Layer } from "effect"
import { parse } from "uri-template"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { LocationServiceMap } from "../location-service-map"
import { LocationRuntimeGuard } from "../location-runtime-guard"
import { MCP } from "../mcp"
import { McpResources } from "../mcp-resources"
import { PermissionV2 } from "../permission"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionLifecycle } from "./lifecycle"
import { SessionIncarnation } from "./incarnation"
import { SessionExecutionPolicy } from "./execution-policy"
import { SessionManagedChild } from "./managed-child"

export const Failure = SessionMcpAttachment.Failure
export interface Interface {
  readonly catalog: (
    sessionID: SessionSchema.ID,
    input: SessionMcpAttachment.CatalogInput,
  ) => Effect.Effect<SessionMcpAttachment.Catalog, SessionMcpAttachment.Failure>
  readonly prepare: (
    sessionID: SessionSchema.ID,
    input: SessionMcpAttachment.Input,
  ) => Effect.Effect<SessionMcpAttachment.Prepared, SessionMcpAttachment.Failure>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMcpAttachment") {}

const make = Effect.gen(function* () {
  const sessions = yield* SessionStore.Service
  const lifecycle = yield* SessionLifecycle.Service
  const locations = yield* LocationServiceMap.Service
  const guard = yield* LocationRuntimeGuard.Service
  const database = yield* Database.Service
  const managed = yield* SessionManagedChild.Service

  const operate = <A>(
    sessionID: SessionSchema.ID,
    server: string | undefined,
    work: (
      mcp: MCP.Interface,
      authorize: (resources: string[]) => Effect.Effect<void, unknown>,
    ) => Effect.Effect<A, unknown>,
  ) =>
    lifecycle
      .run(
        sessionID,
        Effect.gen(function* () {
          const claim = yield* lifecycle.capture(sessionID)
          const session = yield* sessions.get(sessionID)
          const created = yield* SessionIncarnation.created(database.db, sessionID)
          if (!session || !created) return yield* new Failure({ code: "missing", message: "Session not found" })
          if (yield* managed.managed(sessionID))
            return yield* new Failure({ code: "denied", message: "Managed Sessions only accept their owner's input" })
          return yield* Effect.gen(function* () {
            const mcp = yield* MCP.Service
            const permission = yield* PermissionV2.Service
            // Capture after approval: approve-once authorizes this operation without changing persistent rules.
            const fences: Array<() => boolean> = []
            const grants: Array<{ resources: string[]; authority: string; policy: string | undefined }> = []
            const authorize = (resources: string[]) =>
              Effect.gen(function* () {
                if (!resources.length) return
                yield* permission.assert({
                  sessionID,
                  agent: session.agent,
                  action: "read",
                  resources,
                  metadata: { intent: "mcp_attachment" },
                })
                grants.push({
                  resources,
                  authority: JSON.stringify(yield* permission.capture(sessionID, session.agent)),
                  policy: JSON.stringify(yield* SessionExecutionPolicy.forSession(sessionID)),
                })
              })
            const selected = server === undefined ? yield* mcp.resourceServers : [server]
            fences.push(yield* mcp.resourceFence(selected))
            const result = yield* work(mcp, authorize)
            return yield* lifecycle.use(
              sessionID,
              Effect.gen(function* () {
                const current = yield* sessions.get(sessionID)
                if (
                  !lifecycle.available(claim) ||
                  !current ||
                  current.agent !== session.agent ||
                  JSON.stringify(current.location) !== JSON.stringify(session.location) ||
                  (yield* SessionIncarnation.created(database.db, sessionID)) !== created
                )
                  return yield* new Failure({
                    code: "changed",
                    message: "Session changed while preparing MCP attachments",
                  })
                if (fences.some((fence) => !fence()))
                  return yield* new Failure({
                    code: "changed",
                    message: "MCP connection changed while preparing attachments",
                  })
                const inspect = yield* permission.inspect(sessionID, session.agent)
                const authority = JSON.stringify(yield* permission.capture(sessionID, session.agent))
                const policy = JSON.stringify(yield* SessionExecutionPolicy.forSession(sessionID))
                if (
                  grants.some(
                    (grant) =>
                      inspect("read", grant.resources) === "deny" ||
                      grant.authority !== authority ||
                      grant.policy !== policy,
                  )
                )
                  return yield* new Failure({
                    code: "denied",
                    message: "Read authority changed while preparing MCP attachments",
                  })
                return result
              }),
            )
          }).pipe(Effect.provide(locations.get(session.location)), (effect) => guard.use(session.location, effect))
        }),
      )
      .pipe(
        Effect.catchDefect((error) =>
          error instanceof PermissionV2.DeclinedError
            ? Effect.fail(new Failure({ code: "denied", message: "MCP attachment permission declined" }))
            : Effect.die(error),
        ),
        Effect.mapError((error) =>
          error instanceof Failure
            ? error
            : new Failure({
                code:
                  error instanceof PermissionV2.BlockedError || error instanceof PermissionV2.CorrectedError
                    ? "denied"
                    : error instanceof SessionLifecycle.Closed
                      ? "changed"
                      : "unavailable",
                message: error instanceof MCP.Failure ? error.message : "MCP attachment preparation is unavailable",
              }),
        ),
      )

  return Service.of({
    catalog: (sessionID, input) =>
      operate(sessionID, input.server, (mcp, authorize) =>
        Effect.gen(function* () {
          const servers = input.server === undefined ? yield* mcp.resourceServers : [input.server]
          yield* authorize(servers.map((server) => McpResources.permissionResource(server)))
          const resources = yield* mcp.resources(input.server)
          const templates = yield* mcp.resourceTemplates(input.server)
          const output = {
            resources: resources.resources,
            templates: yield* Effect.forEach(templates.resourceTemplates, (template) =>
              Effect.try({
                try: () => ({ ...template, variables: variables(template.uriTemplate) }),
                catch: () => new Failure({ code: "invalid", message: "MCP server returned an invalid URI template" }),
              }),
            ),
            errors: [...resources.errors, ...templates.errors],
          }
          if (
            output.resources.length + output.templates.length > McpResources.MAX_ITEMS ||
            Buffer.byteLength(JSON.stringify(output)) > McpResources.MAX_CATALOG_BYTES
          )
            return yield* new Failure({
              code: "limit",
              message: "Combined resource and template catalog exceeds its limit",
            })
          return output
        }),
      ),
    prepare: (sessionID, input) =>
      operate(sessionID, input.server, (mcp, authorize) =>
        Effect.gen(function* () {
          const uri =
            input.kind === "resource"
              ? input.uri
              : yield* Effect.gen(function* () {
                  yield* authorize([McpResources.permissionResource(input.server)])
                  const templates = yield* mcp.resourceTemplates(input.server)
                  if (!templates.resourceTemplates.some((template) => template.uriTemplate === input.uriTemplate))
                    return yield* new Failure({ code: "changed", message: "Resource template is no longer available" })
                  return yield* Effect.try({
                    try: () => expand(input.uriTemplate, input.parameters),
                    catch: () => new Failure({ code: "invalid", message: "Resource template parameters are invalid" }),
                  })
                })
          yield* authorize([McpResources.permissionResource(input.server, uri)])
          const resource = yield* mcp.readResource(input.server, uri)
          const files = yield* Effect.try({
            try: () => materialize(resource),
            catch: (error) =>
              error instanceof Failure
                ? error
                : new Failure({ code: "invalid", message: "Invalid MCP resource content" }),
          })
          return { server: input.server, resourceURI: uri, files }
        }),
      ),
  })
})

export function variables(template: string) {
  return [
    ...new Set(
      parse(template).ast.parts.flatMap((part) =>
        part.type === "expression" ? part.variables.map((variable) => variable.name) : [],
      ),
    ),
  ]
}
export function expand(template: string, parameters: typeof SessionMcpAttachment.Parameters.Type) {
  const names = variables(template)
  if (
    Buffer.byteLength(JSON.stringify(parameters)) > 65_536 ||
    Object.keys(parameters).some((key) => !names.includes(key)) ||
    names.some((key) => !Object.hasOwn(parameters, key))
  )
    throw new Error("Invalid template parameters")
  const uri = parse(template).expand(parameters)
  if (!uri || uri.length > 16_384 || /[{}]/.test(uri)) throw new Error("Invalid expanded URI")
  return uri
}
export function materialize(resource: McpResources.Read) {
  if (!resource.contents.length || resource.contents.length > 128)
    throw new Failure({ code: "limit", message: "Resource attachment count exceeds its limit" })
  const total = { bytes: 0 }
  const files = resource.contents.map((part, index) => {
    const bytes = "text" in part ? Buffer.from(part.text, "utf8") : Buffer.from(part.blob.replace(/\s/g, ""), "base64")
    if ("text" in part && bytes.toString("utf8") !== part.text)
      throw new Failure({ code: "invalid", message: "Resource text is not valid Unicode" })
    if (part.uri.length > 16_384)
      throw new Failure({ code: "limit", message: "Resource attachment identifier exceeds its limit" })
    total.bytes += bytes.length
    if (total.bytes > McpResources.MAX_CONTENT_BYTES)
      throw new Failure({ code: "limit", message: "Resource attachments exceed the decoded byte limit" })
    if (!("text" in part) && bytes.toString("base64") !== part.blob.replace(/\s/g, ""))
      throw new Failure({ code: "invalid", message: "Resource blob is not canonical base64" })
    const mimeType = "text" in part ? "text/plain" : part.mimeType?.toLowerCase()
    if (
      !mimeType ||
      !["text/plain", "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mimeType)
    )
      throw new Failure({
        code: "unsupported",
        message: `Unsupported resource attachment type: ${mimeType ?? "unknown"}`,
      })
    if (mimeType === "text/plain") new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    if (
      (mimeType === "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mimeType === "image/jpeg" && !bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
      (mimeType === "image/gif" && !["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) ||
      (mimeType === "image/webp" &&
        !(bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")) ||
      (mimeType === "application/pdf" && bytes.subarray(0, 5).toString() !== "%PDF-")
    )
      throw new Failure({ code: "invalid", message: "Resource attachment signature does not match its MIME type" })
    return { uri: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType, name: `${part.uri} (${index + 1})` }
  })
  if (Buffer.byteLength(JSON.stringify(files)) > 16 * 1024 * 1024)
    throw new Failure({ code: "limit", message: "Serialized resource attachments exceed their limit" })
  return files
}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionStore.node,
    SessionLifecycle.node,
    SessionManagedChild.node,
    LocationServiceMap.node,
    LocationRuntimeGuard.node,
    Database.node,
  ],
})
