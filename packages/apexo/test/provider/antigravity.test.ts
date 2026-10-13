import { describe, expect, test } from "bun:test"
import path from "node:path"
import { DateTime, Effect, Exit, Layer } from "effect"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { mergeDeep } from "remeda"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Antigravity } from "@apexo/core/antigravity"
import { AppProcess } from "@apexo/core/process"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { FSUtil } from "@apexo/core/fs-util"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { LayerNodePlatform } from "@apexo/core/effect/app-node-platform"
import { Integration } from "@apexo/core/integration"
import { Credential } from "@apexo/core/credential"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { Catalog } from "@apexo/core/catalog"
import { Location } from "@apexo/core/location"
import { Project } from "@apexo/core/project"
import { AbsolutePath } from "@apexo/core/schema"
import { EventV2 } from "@apexo/core/event"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionRunnerModel } from "@apexo/core/session/runner/model"
import { AntigravityPlugin } from "@apexo/core/plugin/provider/antigravity"
import { LLM, Message, ToolDefinition } from "@apexo/llm"
import { route, protocol } from "@apexo/llm/protocols/antigravity"
import { Auth, LLMClient, RequestExecutor } from "@apexo/llm/route"
import { createAntigravityFetch } from "../../src/plugin/antigravity"
import { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { node, Service } from "../../src/auth"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const token = (access = "fixture-access", expiry = Date.now() + 3600_000) => ({
  token: { access_token: access, refresh_token: "fixture-refresh", expiry: new Date(expiry).toISOString() },
  auth_method: "consumer",
})
const nativeModels = [
  { id: "fixture-model", name: "Fixture", supportsImages: true, maxTokens: 100_000, maxOutputTokens: 8192 },
  ...["high", "low", "medium"].map((effort) => ({
    id: `claude-sonnet-5-5-${effort}`,
    name: `Claude Sonnet 5.5 (${effort})`,
    supportsThinking: true,
  })),
  { id: "gemini-flash-low", name: "Gemini Flash (Low)", supportsThinking: true },
  { id: "gemini-flash-high", name: "Gemini Flash (High)", supportsThinking: true },
  { id: "gemini-flash-tiered", name: "Gemini Flash", supportsThinking: true },
  { id: "gemini-pro-tiered", name: "gemini-pro-tiered", supportsThinking: true },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
]
const nativeLayer = Layer.succeed(Antigravity.Service, {
  available: Effect.succeed(true),
  connect: Effect.succeed(true),
  command: Effect.succeed("agy"),
  session: Effect.succeed({ access: "fixture-secret", projectID: "project" }),
  models: Effect.succeed(nativeModels),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      AppProcess.node,
      CrossSpawnSpawner.node,
      FSUtil.node,
      LayerNodePlatform.filesystem,
      LayerNodePlatform.path,
      LayerNodePlatform.httpClient,
    ]),
  ),
)

describe("native agy credentials", () => {
  test("decodes macOS go-keyring and the native file without exposing invalid input", () => {
    const value = token()
    expect(
      Antigravity.decodeCredential(`go-keyring-base64:${Buffer.from(JSON.stringify(value)).toString("base64")}\n`),
    ).toEqual(value)
    expect(Antigravity.decodeCredential(JSON.stringify(value))).toEqual(value)
    expect(Antigravity.decodeCredential("secret-but-not-json")).toBeUndefined()
    expect(
      Antigravity.decodeCredential(JSON.stringify({ token: { ...value.token, expiry: "invalid" } })),
    ).toBeUndefined()
  })

  test("includes tiered Gemini models alongside recommended models and excludes stale entries", () => {
    expect(
      Antigravity.catalogModels({
        models: { claude: { displayName: "Claude" }, gemini: {}, stale: {} },
        agentModelSorts: [{ groups: [{ modelIds: ["claude", "missing"] }] }],
        tieredModelIds: { flash: ["gemini"], pro: ["gemini"] },
      }).map((model) => model.id),
    ).toEqual(["claude", "gemini"])
  })

  test("groups native tiers, preserves their order for Default, and only advertises available levels", () => {
    const models = Antigravity.modelGroups(nativeModels)
    expect(models.find((model) => model.id === "gemini-pro")?.name).toBe("gemini-pro")
    expect(models.filter((model) => model.status === "active").map((model) => model.id)).toEqual([
      "fixture-model",
      "claude-sonnet-5-5",
      "gemini-flash",
      "gemini-pro",
      "gpt-oss-120b",
    ])
    expect(models.find((model) => model.id === "claude-sonnet-5-5")).toMatchObject({
      name: "Claude Sonnet 5.5",
      nativeID: "claude-sonnet-5-5-high",
      variants: [
        { id: "low", modelID: "claude-sonnet-5-5-low" },
        { id: "medium", modelID: "claude-sonnet-5-5-medium" },
        { id: "high", modelID: "claude-sonnet-5-5-high" },
      ],
    })
    expect(models.find((model) => model.id === "gpt-oss-120b")?.variants.map((variant) => variant.id)).toEqual([
      "medium",
    ])
    expect(models.find((model) => model.id === "gemini-flash")?.variants).toEqual([
      { id: "low", modelID: "gemini-flash-low", thinkingLevel: undefined },
      { id: "medium", modelID: "gemini-flash-tiered", thinkingLevel: "medium" },
      { id: "high", modelID: "gemini-flash-high", thinkingLevel: undefined },
    ])
    expect(models.find((model) => model.id === "claude-sonnet-5-5-low")).toMatchObject({
      status: "deprecated",
      nativeID: "claude-sonnet-5-5-low",
    })
  })

  it.live("returns login-required without launching agy and rereads native login/logout", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const process = yield* AppProcess.Service
      const http = yield* HttpClient.HttpClient
      const native = yield* Antigravity.make({
        process,
        fs,
        http,
        home: dir,
        directory: dir,
        platform: "linux",
        keyring: false,
      })
      expect(yield* native.available).toBe(false)
      expect(Exit.isFailure(yield* Effect.exit(native.session))).toBe(true)
      yield* fs.writeFileString(path.join(dir, "antigravity-oauth-token"), JSON.stringify(token()))
      expect(yield* native.available).toBe(true)
      yield* fs.remove(path.join(dir, "antigravity-oauth-token"))
      expect(yield* native.available).toBe(false)
    }),
  )

  it.live("prefers the native keyring and never includes secrets in parse errors", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const process = yield* AppProcess.Service
      const http = yield* HttpClient.HttpClient
      const calls: string[][] = []
      const native = yield* Antigravity.make({
        fs,
        http,
        home: dir,
        directory: dir,
        platform: "darwin",
        process: {
          ...process,
          run: (command) =>
            Effect.sync(() => {
              if (command._tag !== "StandardCommand") throw new Error("Expected keyring lookup")
              calls.push([command.command, ...command.args])
              return {
                command: command.command,
                exitCode: 0,
                stdout: Buffer.from("invalid-native-secret"),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
              }
            }),
        },
      })
      yield* fs.writeFileString(path.join(dir, "antigravity-oauth-token"), JSON.stringify(token()))
      const error = yield* native.available.pipe(Effect.flip)
      expect(error.message).not.toContain("invalid-native-secret")
      expect(error.message).toContain("unsupported format")
      expect(calls).toEqual([["security", "find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"]])
    }),
  )

  it.live("refreshes once through the real native command and shares discovery across concurrent requests", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const processService = yield* AppProcess.Service
      const http = yield* HttpClient.HttpClient
      const file = path.join(dir, "antigravity-oauth-token")
      const calls: string[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: async (request) => {
              calls.push(new URL(request.url).pathname)
              expect(request.headers.get("authorization")).toBe("Bearer refreshed")
              await request.json()
              return Response.json(
                request.url.includes("loadCodeAssist")
                  ? { cloudaicompanionProject: { id: "fixture-project" } }
                  : { models: { fixture: { displayName: "Fixture" } } },
              )
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* fs.writeFileString(file, JSON.stringify(token("expired", 0)))
      const executable = path.join(dir, ".local", "bin", "agy")
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
      yield* fs.writeFileString(
        executable,
        `#!${process.execPath}\nif (process.argv[2] !== "models") process.exit(1)\nawait Bun.write(${JSON.stringify(file)}, ${JSON.stringify(JSON.stringify(token("refreshed")))})\n`,
      )
      yield* fs.chmod(executable, 0o700)
      const native = yield* Antigravity.make({
        fs,
        process: processService,
        home: dir,
        directory: dir,
        platform: "linux",
        keyring: false,
        http: http.pipe(
          HttpClient.mapRequest((request) =>
            HttpClientRequest.setUrl(request, `${server.url.origin}${new URL(request.url).pathname}`),
          ),
        ),
      })
      const sessions = yield* Effect.all([native.session, native.session, native.session], { concurrency: "unbounded" })
      sessions.forEach((session) => expect(session).toEqual({ access: "refreshed", projectID: "fixture-project" }))
      expect(calls).toEqual(["/v1internal:loadCodeAssist"])
      expect((yield* native.models)[0].id).toBe("fixture")
      expect((yield* native.models)[0].id).toBe("fixture")
      expect(calls.filter((call) => call.endsWith("fetchAvailableModels"))).toHaveLength(1)
    }),
  )

  it.live("requests native login only for authentication failures, not quota or service failures", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const process = yield* AppProcess.Service
      const http = yield* HttpClient.HttpClient
      const status = { value: 401 }
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: async (request) => {
              await request.json()
              return Response.json({ error: "private-account-details" }, { status: status.value })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* fs.writeFileString(path.join(dir, "antigravity-oauth-token"), JSON.stringify(token()))
      const native = yield* Antigravity.make({
        process,
        fs,
        home: dir,
        directory: dir,
        platform: "linux",
        keyring: false,
        http: http.pipe(HttpClient.mapRequest((request) => HttpClientRequest.setUrl(request, server.url))),
      })
      expect(yield* native.connect).toBe(false)
      yield* Effect.forEach([403, 429, 503], (code) =>
        Effect.gen(function* () {
          status.value = code
          const error = yield* native.connect.pipe(Effect.flip)
          expect(error.loginRequired).toBe(false)
          expect(error.message).toContain(`HTTP ${code}`)
          expect(error.message).not.toContain("private-account-details")
        }),
      )
    }),
  )
})

const integration = testEffect(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node])))
integration.live("external connections persist only a reference and resolve the current native token", () =>
  Effect.gen(function* () {
    const service = yield* Integration.Service
    const credentials = yield* Credential.Service
    const integrationID = Integration.ID.make("external-fixture")
    const methodID = Integration.MethodID.make("agy")
    const current = { available: false, key: "first-secret" }
    yield* service.transform((draft) =>
      Effect.sync(() =>
        draft.method.update({
          integrationID,
          method: { id: methodID, type: "external", label: "Native", command: ["agy"] },
          available: Effect.sync(() => current.available),
          resolve: Effect.sync(() => ({ type: "key" as const, key: current.key })),
        }),
      ),
    )
    expect(yield* service.connection.external({ integrationID, methodID })).toBe(false)
    expect(yield* credentials.list(integrationID)).toHaveLength(0)
    current.available = true
    expect(yield* service.connection.external({ integrationID, methodID })).toBe(true)
    expect(yield* service.connection.external({ integrationID, methodID })).toBe(true)
    const saved = yield* credentials.list(integrationID)
    expect(saved).toHaveLength(1)
    expect(saved[0].value).toEqual({ type: "external", methodID })
    expect(JSON.stringify(saved)).not.toContain("secret")
    const active = yield* service.connection.active(integrationID)
    expect(active).toBeDefined()
    expect(yield* service.connection.resolve(active!)).toEqual({ type: "key", key: "first-secret" })
    current.key = "second-secret"
    expect(yield* service.connection.resolve(active!)).toEqual({ type: "key", key: "second-secret" })
    yield* service.connection.remove(saved[0].id)
    expect(current.available).toBe(true)
  }),
)

const provider = testEffect(
  AppNodeBuilder.build(LayerNode.group([Provider.node, node]), [[Antigravity.node, nativeLayer]]),
)
provider.instance("the default V1 provider discovers native models and stores no tokens", () =>
  Effect.gen(function* () {
    const models = yield* Provider.Service
    const auth = yield* Service
    yield* Effect.addFinalizer(() => auth.remove("antigravity").pipe(Effect.orDie))
    const catalog = yield* models.list()
    const antigravity = catalog[ProviderV2.ID.make("antigravity")]
    expect(antigravity.models[ModelV2.ID.make("fixture-model")]).toMatchObject({
      providerID: "antigravity",
      api: { npm: "@ai-sdk/google" },
      name: "Fixture",
    })
    expect(yield* auth.get("antigravity")).toEqual({ type: "external", method: 0 })
    expect(antigravity.options.apiKey).toBe("native-agy-session")
    expect(typeof antigravity.options.fetch).toBe("function")
  }),
)

provider.instance("V1 model and reasoning selection reach matching native IDs without conflicting overrides", () =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const auth = yield* Service
    yield* Effect.addFinalizer(() => auth.remove("antigravity").pipe(Effect.orDie))
    const bodies: unknown[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: async (request) => {
            bodies.push(await request.json())
            return Response.json({
              response: {
                candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
              },
            })
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const google = createGoogleGenerativeAI({
      apiKey: "dummy",
      fetch: Object.assign(
        createAntigravityFetch(
          async () => ({ access: "fixture-secret", projectID: "project" }),
          Object.assign((_url: RequestInfo | URL, init?: RequestInit) => fetch(server.url, init), {
            preconnect: fetch.preconnect,
          }),
          Antigravity.modelGroups(nativeModels),
        ),
        { preconnect: fetch.preconnect },
      ),
    })
    const catalog = (yield* providers.list())[ProviderV2.ID.make("antigravity")]
    expect(Provider.sort(Object.values(catalog.models)).map((model) => model.id)).not.toContain(
      "claude-sonnet-5-5-high",
    )
    for (const id of [
      "claude-sonnet-5-5",
      "claude-sonnet-5-5-low",
      "gemini-flash",
      "gemini-pro",
      "gpt-oss-120b",
      "fixture-model",
    ]) {
      const model = yield* providers.getModel(ProviderV2.ID.make("antigravity"), ModelV2.ID.make(id))
      const group = Antigravity.modelGroups(nativeModels).find((item) => item.id === id)!
      expect(Object.keys(model.variants ?? {})).toEqual(group.variants.map((variant) => variant.id))
      expect(ProviderTransform.variants(model)).toEqual({})
      for (const effort of [undefined, ...Object.keys(model.variants ?? {})]) {
        const options = mergeDeep(
          ProviderTransform.options({ model, sessionID: "fixture", providerOptions: {} }),
          effort ? model.variants![effort] : {},
        )
        yield* Effect.promise(() =>
          google(model.api.id).doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions: ProviderTransform.providerOptions(model, options),
          }),
        )
        const selected = group.variants.find((variant) => variant.id === effort)
        expect(bodies.at(-1)).toMatchObject({
          model: selected?.modelID ?? group.nativeID,
          request: { contents: [{ role: "user", parts: [{ text: "Hello" }] }] },
        })
        const body = bodies.at(-1) as {
          request: { generationConfig: { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } } }
        }
        expect(body.request.generationConfig.thinkingConfig?.thinkingLevel).toBe(selected?.thinkingLevel)
        expect(body.request.generationConfig.thinkingConfig?.thinkingBudget).toBeUndefined()
      }
    }
    yield* Effect.promise(async () => {
      await expect(
        google("gpt-oss-120b").doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
          providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } },
        }),
      ).rejects.toThrow("Unsupported Antigravity reasoning level")
    })
  }),
)

const v2 = testEffect(
  AppNodeBuilder.build(LayerNode.group([Catalog.node, Antigravity.node, Integration.node, EventV2.node]), [
    [Antigravity.node, nativeLayer],
    [
      Location.node,
      Layer.succeed(Location.Service, {
        directory: AbsolutePath.make("/antigravity-fixture"),
        project: { id: Project.ID.make("fixture"), directory: AbsolutePath.make("/antigravity-fixture") },
      }),
    ],
  ]).pipe(
    Layer.merge(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer))))),
  ),
)

v2.live("V2 resolves the same grouped models, native defaults and reasoning variants", () =>
  Effect.gen(function* () {
    // This built-in uses Effect services directly, not the public plugin context.
    yield* AntigravityPlugin.effect({} as Parameters<typeof AntigravityPlugin.effect>[0])
    const catalog = yield* Catalog.Service
    const client = yield* LLMClient.Service
    const providerID = ProviderV2.ID.make("antigravity")
    const credential = { type: "key" as const, key: "fixture-secret", metadata: { projectID: "project" } }
    for (const group of Antigravity.modelGroups(nativeModels)) {
      const model = (yield* catalog.model.get(providerID, ModelV2.ID.make(group.id)))!
      expect(model.status).toBe(group.status)
      expect(model.name).toBe(group.name)
      expect(model.variants.map((variant) => String(variant.id))).toEqual(group.variants.map((variant) => variant.id))
      for (const effort of [undefined, ...group.variants.map((variant) => variant.id)]) {
        const resolved = yield* SessionRunnerModel.resolve(
          {
            id: SessionSchema.ID.make("ses_fixture"),
            projectID: Project.ID.make("fixture"),
            model: { providerID, id: model.id, variant: effort ? ModelV2.VariantID.make(effort) : undefined },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
            title: "Fixture",
            location: { directory: AbsolutePath.make("/antigravity-fixture") },
          },
          model,
          credential,
        )
        const prepared = yield* client.prepare<{
          model: string
          request: { generationConfig?: { thinkingConfig?: { thinkingLevel?: string } } }
        }>(LLM.request({ model: resolved, prompt: "Hello" }))
        const selected = group.variants.find((variant) => variant.id === effort)
        expect(prepared.body.model).toBe(selected?.modelID ?? group.nativeID)
        expect(prepared.body.request.generationConfig?.thinkingConfig?.thinkingLevel).toBe(selected?.thinkingLevel)
      }
    }
  }),
)

const llm = testEffect(
  LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
)
llm.live("native streams preserve tool IDs and signatures through the next provider turn", () =>
  Effect.gen(function* () {
    const frame = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { id: "call-native", name: "lookup", args: { value: 1 } },
                  thoughtSignature: "signed-fixture",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    }
    const requestBodies: unknown[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: async (request) => {
            requestBodies.push(await request.json())
            return new Response(`data: ${JSON.stringify(frame)}\n\n`, {
              headers: { "content-type": "text/event-stream" },
            })
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const model = route
      .with({
        endpoint: { baseURL: server.url.origin },
        auth: Auth.bearer("fixture"),
        providerOptions: { antigravity: { projectID: "project", sessionID: "session" } },
      })
      .model({ id: "fixture" })
    const request = LLM.request({
      model,
      prompt: "Look up 1",
      tools: [
        ToolDefinition.make({
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
        }),
      ],
    })
    const response = yield* LLMClient.generate(request)
    expect(response.toolCalls[0]).toMatchObject({
      id: "call-native",
      name: "lookup",
      providerMetadata: { google: { thoughtSignature: "signed-fixture" } },
    })
    const next = yield* protocol.body.from(
      LLM.request({
        model,
        providerOptions: { antigravity: { projectID: "project", sessionID: "session" } },
        messages: [
          Message.user("Look up 1"),
          Message.assistant(response.toolCalls[0]),
          Message.tool({ id: "call-native", name: "lookup", result: { type: "text", value: "found" } }),
        ],
      }),
    )
    expect(next.project).toBe("project")
    expect(next.request.sessionId).toBe("session")
    expect(next.request.contents[1].parts[0]).toMatchObject({
      functionCall: { id: "call-native" },
      thoughtSignature: "signed-fixture",
    })
    expect(next.request.contents[2].parts[0]).toMatchObject({ functionResponse: { id: "call-native" } })
    expect(requestBodies).toHaveLength(1)
  }),
)

test("V1 unwraps split SSE frames, preserves cancellation and removes the SDK dummy key", async () => {
  const requests: Request[] = []
  const bodies: unknown[] = []
  using server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push(request)
      bodies.push(await request.json())
      const frame = `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "OK" }] } }] } })}\r\n\r\n`
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame.slice(0, 19)))
            controller.enqueue(new TextEncoder().encode(frame.slice(19)))
            controller.close()
          },
        }),
      )
    },
  })
  const native = createAntigravityFetch(
    async () => ({ access: "fixture-access", projectID: "fixture-project" }),
    Object.assign(
      (url: RequestInfo | URL, init?: RequestInit) =>
        fetch(`${server.url.origin}${new URL(String(url)).pathname}`, init),
      { preconnect: fetch.preconnect },
    ),
  )
  const response = await native("https://example.invalid/v1beta/models/gemini:streamGenerateContent", {
    method: "POST",
    headers: { "x-goog-api-key": "dummy" },
    body: JSON.stringify({ contents: [] }),
  })
  expect(await response.text()).toBe('data: {"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}\n\n')
  expect(requests[0].headers.get("authorization")).toBe("Bearer fixture-access")
  expect(requests[0].headers.has("x-goog-api-key")).toBe(false)
  expect(bodies[0]).toMatchObject({ project: "fixture-project", model: "gemini", request: { contents: [] } })
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(
    native("https://example.invalid/models/gemini:streamGenerateContent", {
      method: "POST",
      body: "{}",
      signal: cancelled.signal,
    }),
  ).rejects.toThrow()
})
