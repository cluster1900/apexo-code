import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { httpClient } from "@apexo/core/effect/app-node-platform"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { EventV2 } from "@apexo/core/event"
import { Credential } from "@apexo/core/credential"
import { PermissionSaved } from "@apexo/core/permission/saved"
import { PtyTicket } from "@apexo/core/pty/ticket"
import { ProjectCatalog } from "@apexo/core/project/catalog"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionProcessControl } from "@apexo/core/session/process-control"
import { SessionProcessCompletion } from "@apexo/core/session/process-completion"
import { SessionTaskControl } from "@apexo/core/session/task-control"
import { SessionGoalControl } from "@apexo/core/session/goal-control"
import { WorkflowControl } from "@apexo/core/workflow/control"
import { SessionSideQuestionNative } from "@apexo/core/session/side-question-native"
import { SessionV2 } from "@apexo/core/session"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMcpAttachmentOperation } from "@apexo/core/session/mcp-attachment-operation"
import { SessionMemoryOperation } from "@apexo/core/session/memory-operation"
import { SessionMemoryModeNative } from "@apexo/core/session/memory-mode-native"
import { SessionExecution } from "@apexo/core/session/execution"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { ToolOutputStore } from "@apexo/core/tool-output-store"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { corsLayer } from "./middleware/cors"
import { PtyEnvironment } from "./pty-environment"
import { layer as locationLayer } from "./location"
import { sessionLocationLayer } from "./middleware/session-location"

const applicationServices = LayerNode.group([
  Global.node,
  Database.node,
  ProjectCatalog.node,
  EventV2.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  SessionV2.node,
  SessionLifecycle.node,
  SessionExecution.node,
  SessionMemoryModeNative.node,
  SessionMemoryOperation.node,
  SessionMcpAttachmentOperation.node,
  SessionGoalControl.node,
  SessionTaskControl.node,
  SessionProcessControl.node,
  SessionScheduleStore.node,
  SessionProcessCompletion.node,
  WorkflowControl.node,
  SessionSideQuestionNative.node,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
])

export function createRoutes(password?: string) {
  return makeRoutes(
    password
      ? ServerAuth.Config.configLayer({ username: "apexo", password: Option.some(password) })
      : ServerAuth.Config.layer,
  )
}

export function createEmbeddedRoutes() {
  return makeRoutes(ServerAuth.Config.configLayer({ username: "apexo", password: Option.none() }))
}

function makeRoutes<AuthError, AuthServices>(auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>) {
  const serviceLayer = AppNodeBuilder.build(applicationServices, [[SessionExecution.node, SessionExecutionLocal.node]])

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(corsLayer),
    Layer.provide(handlers),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
