import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Project } from "@apexo/schema/project"
import { AbsolutePath } from "@apexo/schema/schema"
import { Location } from "@apexo/schema/location"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    TestLLMServer.layer,
  ),
)

describe("Native project bootstrap", () => {
  for (const git of [false, true]) {
    it.instance(
      `serves actual project identity and catalog for ${git ? "Git" : "plain"} Locations without model work`,
      () =>
        Effect.gen(function* () {
          const instance = yield* TestInstance
          const llm = yield* TestLLMServer
          const query = new URLSearchParams({ "location[directory]": instance.directory })
          const currentResponse = yield* HttpClient.get(`/api/project/current?${query}`)
          expect(currentResponse.status).toBe(200)
          const current = yield* Schema.decodeUnknownEffect(Project.Current)(yield* currentResponse.json)
          const locationResponse = yield* HttpClient.get(`/api/location?${query}`)
          const location = yield* Schema.decodeUnknownEffect(Location.Info)(yield* locationResponse.json)
          expect(current).toEqual(location.project)
          const created = yield* HttpClientRequest.post("/api/session").pipe(
            HttpClientRequest.bodyJson({ location: { directory: instance.directory } }),
            Effect.flatMap(HttpClient.execute),
          )
          expect(created.status).toBe(200)
          const session = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ data: Schema.Struct({ projectID: Project.ID, location: Location.Ref }) }),
          )(yield* created.json)
          expect(session.data.projectID).toBe(current.id)
          expect(session.data.location.directory).toBe(AbsolutePath.make(instance.directory))
          const listed = yield* HttpClient.get("/api/project")
          expect(listed.status).toBe(200)
          const projects = yield* Schema.decodeUnknownEffect(Schema.Array(Project.Info))(yield* listed.json)
          const project = projects.find((project) => project.id === current.id)
          expect(project).toBeDefined()
          expect(project!.worktree).toBe(current.directory)
          expect(project!.time.created).toBeGreaterThan(0)
          expect(project!.sandboxes).toEqual([])
          expect(yield* llm.calls).toBe(0)
        }),
      { git },
      30_000,
    )
  }
})
