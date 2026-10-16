import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Fiber, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AISDK } from "@apexo/core/aisdk"
import { Catalog } from "@apexo/core/catalog"
import { Config } from "@apexo/core/config"
import { Global } from "@apexo/core/global"
import { Integration } from "@apexo/core/integration"
import { Location } from "@apexo/core/location"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MemoryEmbedding } from "@apexo/core/memory-embedding"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { MemorySearch } from "@apexo/core/memory-search"
import { ModelsDev } from "@apexo/core/models-dev"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer, FetchHttpClient.layer),
)

it.live("index initialization validates redirected ancestors before creating directories", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    yield* Effect.promise(() => symlink(outside, path.join(home, ".grok")))
    expect((yield* Effect.exit(MemorySearch.make({ directory: home, home, projectID: "redirected" })))._tag).toBe(
      "Failure",
    )
    expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
  }),
)

it.live("persistent full-text search ranks scoped notes and returns accurate line ranges", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "search-repo" }
    yield* Effect.promise(() =>
      WorkspaceMemory.update(
        directory,
        { operation: "remember", scope: "global", content: "Global authentication preference" },
        home,
        input,
      ),
    )
    const root = path.dirname(WorkspaceMemory.file(directory, home, input))
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "topics"), { recursive: true })
      await mkdir(path.join(root, "sessions"))
      await writeFile(
        path.join(root, "topics", "auth.md"),
        "# Authentication\n\nAuthentication middleware uses a session cookie.\n中文数据库连接池配置。\n",
      )
      await writeFile(path.join(root, "sessions", "old.md"), "# Session\n\nInvestigated cookie authentication.\n")
      await WorkspaceMemory.update(directory, { operation: "remember", content: "FOREIGN_AUTH_SECRET" }, home, {
        projectID: "foreign",
      })
    })
    yield* Effect.gen(function* () {
      const memory = yield* MemorySearch.make(input)
      const result = yield* memory.search({ query: "authentication", min_score: 0 })
      expect(result.mode).toBe("fts")
      expect(result.results.length).toBe(3)
      expect(result.results.map((result) => result.source).sort()).toEqual(["global", "session", "workspace"])
      expect(result.results.every((result) => result.score >= 0 && result.score <= 1)).toBe(true)
      for (const match of result.results) {
        const content = yield* memory.get({
          path: match.path,
          from: match.start_line,
          lines: match.end_line - match.start_line + 1,
        })
        expect(content.content.replace(/^\d+→/gm, "").startsWith(match.snippet)).toBe(true)
      }
      expect((yield* memory.search({ query: "数据库" })).results[0]?.path).toEndWith("auth.md")
      expect((yield* memory.search({ query: "FOREIGN_AUTH_SECRET" })).results).toEqual([])
      expect((yield* memory.search({ query: "authentication", max_results: 1 })).results).toHaveLength(1)
      expect((yield* memory.search({ query: "authentication", max_results: 0 })).results).toEqual([])
      expect((yield* memory.search({ query: '" OR * () :' })).results).toEqual([])
      expect((yield* memory.search({ query: "authentication", min_score: 2 })).results).toEqual([])
      expect((yield* memory.refresh).updated).toBe(0)
    }).pipe(Effect.scoped)
    const header = yield* Effect.promise(() => readFile(path.join(root, "search.sqlite")))
    expect(header.subarray(0, 15).toString()).toBe("SQLite format 3")
    const reopened = yield* MemorySearch.make({ ...input, watch: false })
    expect((yield* reopened.search({ query: "middleware" })).results).toHaveLength(1)
  }),
)

it.live("external edit, atomic replacement, deletion and new topics refresh without restarting", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "changes" }
    yield* Effect.promise(() =>
      WorkspaceMemory.update(directory, { operation: "remember", content: "originaltoken" }, home, input),
    )
    const memory = yield* MemorySearch.make(input)
    expect(memory.watching).toBe(true)
    expect((yield* memory.search({ query: "originaltoken" })).results).toHaveLength(1)
    const target = WorkspaceMemory.file(directory, home, input)
    yield* Effect.promise(async () => {
      await writeFile(`${target}.tmp`, "# Memory\n\nreplacementtoken\n")
      await rename(`${target}.tmp`, target)
    })
    expect((yield* memory.search({ query: "originaltoken" })).results).toEqual([])
    expect((yield* memory.search({ query: "replacementtoken" })).results).toHaveLength(1)
    yield* Effect.promise(async () => {
      await mkdir(path.join(path.dirname(target), "topics", "nested"), { recursive: true })
      await writeFile(path.join(path.dirname(target), "topics", "nested", "new.md"), "nestedtopic\n")
      await rm(target)
    })
    expect((yield* memory.search({ query: "replacementtoken" })).results).toEqual([])
    expect((yield* memory.search({ query: "nestedtopic" })).results).toHaveLength(1)
  }),
)

it.live("memory_get supports zero-based compatibility, blank final lines and scope boundaries", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "reads" }
    const memory = yield* MemorySearch.make(input)
    const target = WorkspaceMemory.file(directory, home, input)
    yield* Effect.promise(() => writeFile(target, "alpha\nbeta\n"))
    expect((yield* memory.get({ path: "MEMORY.md", from: 0 })).content).toBe("1→alpha\n2→beta\n3→")
    expect((yield* memory.get({ path: target, from: 2, lines: 1 })).content).toBe("2→beta")
    expect((yield* memory.get({ path: target, lines: 0 })).content).toBe("")
    expect((yield* memory.get({ path: target, from: 100 })).content).toBe("")
    const outside = path.join(directory, "private.md")
    yield* Effect.promise(() => writeFile(outside, "PRIVATE_VALUE"))
    expect((yield* Effect.exit(memory.get({ path: outside })))._tag).toBe("Failure")
    expect((yield* Effect.exit(memory.get({ path: "../../private.md" })))._tag).toBe("Failure")
    yield* Effect.promise(() => symlink(outside, path.join(path.dirname(target), "linked.md")))
    expect((yield* Effect.exit(memory.get({ path: path.join(path.dirname(target), "linked.md") })))._tag).toBe(
      "Failure",
    )
    expect((yield* memory.search({ query: "PRIVATE_VALUE" })).results).toEqual([])
  }),
)

it.live("a symlink replacing an indexed topic is removed without exposing its new target", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "symlinks" }
    const memory = yield* MemorySearch.make(input)
    const topics = path.join(path.dirname(WorkspaceMemory.file(directory, home, input)), "topics")
    const outside = path.join(directory, "outside")
    yield* Effect.promise(async () => {
      await mkdir(topics)
      await mkdir(outside)
      await writeFile(path.join(topics, "test.md"), "previousnote\n")
      await writeFile(path.join(outside, "test.md"), "outsidesecret\n")
    })
    expect((yield* memory.search({ query: "previousnote" })).results).toHaveLength(1)
    yield* Effect.promise(async () => {
      await rm(topics, { recursive: true })
      await symlink(outside, topics, "dir")
    })
    expect((yield* memory.search({ query: "previousnote outsidesecret" })).results).toEqual([])
    expect((yield* Effect.exit(memory.get({ path: path.join(topics, "test.md") })))._tag).toBe("Failure")
  }),
)

it.live("cached results recheck source permissions and large notes remain searchable and readable", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "permissions" }
    const memory = yield* MemorySearch.make({ ...input, watch: false })
    const target = WorkspaceMemory.file(directory, home, input)
    yield* Effect.promise(() => writeFile(target, "privatecachedtoken\n"))
    const authorized: string[][] = []
    const allow = (paths: string[]) =>
      Effect.sync(() => {
        authorized.push(paths)
      })
    expect((yield* memory.search({ query: "privatecachedtoken" }, allow)).results).toHaveLength(1)
    expect((yield* memory.search({ query: "privatecachedtoken" }, allow)).results).toHaveLength(1)
    expect(authorized).toEqual([[target], [target]])
    const denied = yield* Effect.exit(
      memory.search({ query: "privatecachedtoken" }, () => Effect.die(new Error("read denied"))),
    )
    expect(denied._tag).toBe("Failure")
    yield* Effect.promise(() => writeFile(target, `${" ".repeat(4 * 1024 * 1024 + 1)}\nlargefinaltoken\n`))
    expect((yield* memory.search({ query: "privatecachedtoken" }, allow)).results).toEqual([])
    expect((yield* memory.search({ query: "largefinaltoken" }, allow)).results).toHaveLength(1)
    expect((yield* memory.get({ path: target, from: 2, lines: 1 })).content).toBe("2→largefinaltoken")
    yield* Effect.promise(() => writeFile(target, "recoveredtoken\n"))
    expect((yield* memory.search({ query: "recoveredtoken" }, allow)).results).toHaveLength(1)
  }),
)

it.live("chunks keep exact nonoverlapping line ranges after leading whitespace", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "chunks" }
    const memory = yield* MemorySearch.make(input)
    const lines = Array.from({ length: 165 }, (_, index) =>
      index === 79 ? "boundary left" : index === 80 ? "boundary right" : "",
    )
    yield* Effect.promise(() => writeFile(WorkspaceMemory.file(directory, home, input), lines.join("\n")))
    const matches = (yield* memory.search({ query: "boundary", min_score: 0 })).results.sort(
      (a, b) => a.start_line - b.start_line,
    )
    expect(matches).toHaveLength(2)
    expect(matches[0]?.start_line).toBe(80)
    expect(matches[0]?.end_line).toBe(80)
    expect(matches[0]?.snippet).toBe("boundary left")
    expect(matches[1]?.start_line).toBe(81)
    expect((yield* memory.get({ path: matches[0]!.path, from: matches[0]!.start_line, lines: 1 })).content).toBe(
      "80→boundary left",
    )
  }),
)

it.live(
  "hybrid search retrieves zero-lexical-overlap chunks only when embeddings are enabled and floors shared FTS scores",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* llm.reset
      const input = { directory, home, projectID: "hybrid-search" }
      const root = path.dirname(WorkspaceMemory.file(directory, home, input))
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "topics"), { recursive: true })
        await writeFile(
          path.join(root, "topics", "animals.md"),
          "# Animals\n\nGolden retriever puppy likes fetch in the park.\n",
        )
        await writeFile(
          path.join(root, "topics", "servers.md"),
          "# Servers\n\nKubernetes ingress controller routes traffic.\n",
        )
      })

      // Negative control: lexical-only search finds zero results for a query with no shared words.
      const lexicalOnly = yield* MemorySearch.make({ ...input, watch: false })
      const lexicalResult = yield* lexicalOnly.search({ query: "canine companion", min_score: 0.5 })
      expect(lexicalResult.mode).toBe("fts")
      expect(lexicalResult.fallback).toBeUndefined()
      expect(lexicalResult.results).toEqual([])

      yield* llm.setEmbed((hit) => {
        const texts = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
        return {
          status: 200,
          body: {
            object: "list",
            data: texts.map((text, index) => ({
              object: "embedding",
              index,
              embedding:
                text.includes("Golden retriever") || text.includes("canine companion")
                  ? [1, 0, 0, 0]
                  : [0, 1, 0, 0],
            })),
          },
        }
      })

      const client = yield* MemoryEmbedding.makeClient({
        providerID: ProviderV2.ID.make("fixture"),
        model: "embed-v1",
        endpoint: llm.url,
        dimensions: 4,
        key: "test-embed-key",
        http: yield* HttpClient.HttpClient,
      }).pipe(Effect.provide(FetchHttpClient.layer))

      const hybrid = yield* MemorySearch.make({
        ...input,
        embedding: client,
        watch: false,
      })

      const semanticMatch = yield* hybrid.search({ query: "canine companion", min_score: 0.5 })
      expect(semanticMatch.mode).toBe("hybrid")
      expect(semanticMatch.fallback).toBeUndefined()
      expect(semanticMatch.results).toHaveLength(1)
      expect(semanticMatch.results[0]?.path).toEndWith("animals.md")
      expect(semanticMatch.results[0]?.score).toBeCloseTo(0.7, 5)
      expect(yield* llm.embedCalls).toBe(1)

      // Second search with cached chunk vectors only embeds the query string.
      const cachedMatch = yield* hybrid.search({ query: "canine companion", min_score: 0.5 })
      expect(cachedMatch.mode).toBe("hybrid")
      expect(cachedMatch.results).toHaveLength(1)
      expect(yield* llm.embedCalls).toBe(2)
      expect((yield* llm.embedHits)[1]?.body.input).toEqual(["canine companion"])

      // Shared FTS + vector result is floored at its full FTS score (1.0) even when vector similarity is 0.
      const sharedFloor = yield* hybrid.search({ query: "Kubernetes", min_score: 0.95 })
      expect(sharedFloor.mode).toBe("hybrid")
      expect(sharedFloor.results).toHaveLength(1)
      expect(sharedFloor.results[0]?.path).toEndWith("servers.md")
      expect(sharedFloor.results[0]?.score).toBeGreaterThanOrEqual(0.95)
    }),
)

it.live(
  "unsupported providers, malformed vectors, dimension mismatches and transport failures degrade cleanly to FTS without caching bad vectors",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* llm.reset
      const input = { directory, home, projectID: "hybrid-fallbacks" }
      const target = WorkspaceMemory.file(directory, home, input)
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, "# Notes\n\nReliable lexical fallback token.\n")
      })

      // 1. Unsupported local/auto providers reject cleanly and degrade to FTS with unsupported_provider.
      for (const provider of ["local", "auto"] as const) {
        const memory = yield* MemorySearch.make({
          ...input,
          embedding: () => MemoryEmbedding.parseModelReference({ provider, model: "local-model" }).pipe(Effect.as(undefined)),
          watch: false,
        })
        const res = yield* memory.search({ query: "Reliable", min_score: 0 })
        expect(res.mode).toBe("fts")
        expect(res.fallback).toBe("unsupported_provider")
        expect(res.results).toHaveLength(1)
      }

      const client = yield* MemoryEmbedding.makeClient({
        providerID: ProviderV2.ID.make("fixture"),
        model: "embed-v1",
        endpoint: llm.url,
        dimensions: 4,
        key: "test-embed-key",
        http: yield* HttpClient.HttpClient,
      }).pipe(Effect.provide(FetchHttpClient.layer))

      const memory = yield* MemorySearch.make({
        ...input,
        embedding: client,
        watch: false,
      })

      // 2. Dimension mismatch, duplicate index, out-of-bounds index, non-finite numbers -> malformed_response, 0 cached vectors.
      const malformedPayloads: unknown[] = [
        { object: "list", data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1, 0] }] },
        { object: "list", data: [{ index: 0, embedding: [1, 0, 0, 0] }, { index: 0, embedding: [0, 1, 0, 0] }] },
        { object: "list", data: [{ index: 0, embedding: [1, 0, 0, 0] }, { index: 5, embedding: [0, 1, 0, 0] }] },
        { object: "list", data: [{ index: 0, embedding: [1, 0, 0, 0] }] },
        "{\"data\":[{\"index\":0,\"embedding\":[NaN,0,0,0]}]}",
      ]

      for (const badBody of malformedPayloads) {
        yield* llm.setEmbed(() => ({ status: 200, body: badBody }))
        const res = yield* memory.search({ query: "Reliable", min_score: 0 })
        expect(res.mode).toBe("fts")
        expect(res.fallback).toBe("malformed_response")
        expect(res.results).toHaveLength(1)
      }

      // 3. Unauthorized 401 -> unauthorized fallback, no retry.
      const beforeUnauth = yield* llm.embedCalls
      yield* llm.setEmbed(() => ({ status: 401, body: { error: "unauthorized" } }))
      const unauthRes = yield* memory.search({ query: "Reliable", min_score: 0 })
      expect(unauthRes.mode).toBe("fts")
      expect(unauthRes.fallback).toBe("unauthorized")
      expect((yield* llm.embedCalls) - beforeUnauth).toBe(1)

      // 4. Transient 503 retries up to 3 attempts then succeeds or falls back with transport.
      const beforeRetry = yield* llm.embedCalls
      yield* llm.setEmbed(() => ({ status: 503, body: { error: "unavailable" } }))
      const transportRes = yield* memory.search({ query: "Reliable", min_score: 0 })
      expect(transportRes.mode).toBe("fts")
      expect(transportRes.fallback).toBe("transport")
      expect((yield* llm.embedCalls) - beforeRetry).toBe(3)

      // Verify zero malformed or failed vectors were committed to memory_vectors.
      const db = new Database(path.join(path.dirname(target), "search.sqlite"))
      const vectorCount = db.query<{ count: number }, []>("SELECT count(*) AS count FROM memory_vectors").get()
      db.close()
      expect(Number(vectorCount?.count ?? 0)).toBe(0)
    }),
)

it.live(
  "embedding resolution enforces provider endpoint origin ownership and blocks cross-provider credential leakage",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* llm.reset

      const rogueHits: { headers: IncomingHttpHeaders; url?: string }[] = []
      const rogueServer = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ server: Server; url: string }>((resolve) => {
              const srv = createServer((req, res) => {
                rogueHits.push({ headers: req.headers, url: req.url })
                res.writeHead(200, { "content-type": "application/json" })
                res.end(JSON.stringify({ object: "list", data: [] }))
              })
              srv.listen(0, "127.0.0.1", () => {
                const addr = srv.address()
                const port = typeof addr === "object" && addr ? addr.port : 0
                resolve({ server: srv, url: `http://127.0.0.1:${port}/v1` })
              })
            }),
        ),
        ({ server }) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      )

      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            providers: {
              primary: {
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "SECRET_PRIMARY_KEY" },
                },
                models: {
                  "chat-model": {
                    name: "Primary chat",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                  "hijacked-embed": {
                    name: "Hijacked embed",
                    api: {
                      type: "aisdk",
                      package: "@ai-sdk/openai-compatible",
                      id: "hijacked-embed",
                      url: rogueServer.url,
                    },
                    capabilities: { tools: false, input: ["text"], output: ["text"] },
                    limit: { context: 8192, output: 1024 },
                  },
                  "valid-embed": {
                    name: "Valid embed",
                    capabilities: { tools: false, input: ["text"], output: ["text"] },
                    limit: { context: 8192, output: 1024 },
                  },
                },
              },
              foreign: {
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: rogueServer.url,
                  settings: { apiKey: "FOREIGN_KEY" },
                },
                models: {
                  "foreign-only-embed": {
                    name: "Foreign embed",
                    capabilities: { tools: false, input: ["text"], output: ["text"] },
                    limit: { context: 8192, output: 1024 },
                  },
                },
              },
            },
          }),
        ),
      )

      const layer = AppNodeBuilder.build(
        LayerNode.group([LocationServiceMap.node, Global.node]),
        [
          [Global.node, Global.layerWith({ home })],
          [
            ModelsDev.node,
            Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
          ],
        ],
      )

      yield* Effect.gen(function* () {
        const locations = yield* LocationServiceMap.Service
        yield* Effect.gen(function* () {
          const embedding = yield* MemoryEmbedding.Service

          // Cross-origin model URL override on primary provider must be rejected before any network request.
          const hijacked = yield* embedding
            .resolve({
              embedding: { provider: "api", model: "primary/hijacked-embed", dimensions: 4 },
            })
            .pipe(Effect.result)
          expect(hijacked._tag).toBe("Failure")
          if (hijacked._tag === "Failure") {
            expect(hijacked.failure.reason).toBe("invalid_endpoint")
          }

          // Unqualified model that belongs to another provider must be rejected rather than using primary's key.
          const foreignUnqualified = yield* embedding
            .resolve({
              embedding: { provider: "api", model: "foreign-only-embed", dimensions: 4 },
              fallbackProviderID: ProviderV2.ID.make("primary"),
            })
            .pipe(Effect.result)
          expect(foreignUnqualified._tag).toBe("Failure")
          if (foreignUnqualified._tag === "Failure") {
            expect(foreignUnqualified.failure.reason).toBe("invalid_model")
          }

          expect(rogueHits).toEqual([])

          // Valid same-origin resolution works and sends primary's key only to primary's endpoint.
          const valid = yield* embedding.resolve({
            embedding: { provider: "api", model: "valid-embed", dimensions: 4 },
            fallbackProviderID: ProviderV2.ID.make("primary"),
          })
          expect(valid).toBeDefined()
          const vectors = yield* valid!.embed(["hello"])
          expect(vectors).toHaveLength(1)
          expect(rogueHits).toEqual([])
          expect((yield* llm.embedHits)[0]?.headers.authorization).toBe("Bearer SECRET_PRIMARY_KEY")
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.provide(layer))
    }),
)

it.live(
  "selective vector invalidation preserves unchanged chunk vectors and ranking metadata across content and model changes",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* llm.reset
      const input = { directory, home, projectID: "selective-invalidation" }
      const root = path.dirname(WorkspaceMemory.file(directory, home, input))
      const fileA = path.join(root, "topics", "alpha.md")
      const fileB = path.join(root, "topics", "beta.md")
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "topics"), { recursive: true })
        await writeFile(fileA, "# Alpha\n\nAlpha unchanged memory chunk.\n")
        await writeFile(fileB, "# Beta\n\nBeta initial memory chunk.\n")
      })

      const clientV1 = yield* MemoryEmbedding.makeClient({
        providerID: ProviderV2.ID.make("fixture"),
        model: "embed-v1",
        endpoint: llm.url,
        dimensions: 4,
        key: "key-1",
        http: yield* HttpClient.HttpClient,
      }).pipe(Effect.provide(FetchHttpClient.layer))

      const searchV1 = yield* MemorySearch.make({ ...input, embedding: clientV1, watch: false })
      yield* searchV1.search({ query: "Alpha", min_score: 0 })
      expect(yield* llm.embedCalls).toBe(1)
      // First call embedded 2 missing chunks + 1 query = 3 inputs.
      expect((yield* llm.embedHits)[0]?.body.input).toHaveLength(3)

      // Modify only fileB; fileA's vector must stay cached, so the next search embeds only fileB + query = 2 inputs.
      yield* Effect.promise(() => writeFile(fileB, "# Beta\n\nBeta updated memory chunk.\n"))
      yield* searchV1.search({ query: "Alpha", min_score: 0 })
      expect(yield* llm.embedCalls).toBe(2)
      expect((yield* llm.embedHits)[1]?.body.input).toEqual([
        "# Beta\n\nBeta updated memory chunk.\n",
        "Alpha",
      ])

      // Changing model/dimensions invalidates memory_vectors while preserving memory_files, memory_chunks and memory_ranking.
      const clientV2 = yield* MemoryEmbedding.makeClient({
        providerID: ProviderV2.ID.make("fixture"),
        model: "embed-v2",
        endpoint: llm.url,
        dimensions: 6,
        key: "key-1",
        http: yield* HttpClient.HttpClient,
      }).pipe(Effect.provide(FetchHttpClient.layer))

      const searchV2 = yield* MemorySearch.make({ ...input, embedding: clientV2, watch: false })
      yield* searchV2.search({ query: "Alpha", min_score: 0 })
      expect(yield* llm.embedCalls).toBe(3)
      expect((yield* llm.embedHits)[2]?.body.input).toHaveLength(3)

      const db = new Database(path.join(root, "search.sqlite"))
      const vectors = db
        .query<{ embedding_identity: string; dimensions: number }, []>(
          "SELECT embedding_identity, dimensions FROM memory_vectors",
        )
        .all()
      const ranking = db
        .query<{ path: string; access_count: number }, [string]>(
          "SELECT path, access_count FROM memory_ranking WHERE path = ?",
        )
        .get(fileA)
      db.close()
      expect(vectors).toHaveLength(2)
      expect(vectors.every((row) => row.embedding_identity === clientV2.identity && Number(row.dimensions) === 6)).toBe(
        true,
      )
      expect(Number(ranking?.access_count ?? 0)).toBeGreaterThanOrEqual(3)
    }),
)

for (const mutation of ["revoke_permission", "clear_memory", "edit_file", "replace_symlink"] as const) {
  it.live(
    `held embedding response during ${mutation} prevents stale vector commits and unauthorized leakage`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const outside = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        yield* llm.reset
        const input = { directory, home, projectID: `race-${mutation}` }
        const target = WorkspaceMemory.file(directory, home, input)
        yield* Effect.promise(async () => {
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, "# Secret\n\nSensitive semantic note before mutation.\n")
          await writeFile(path.join(outside, "outside.md"), "OUTSIDE_SYMLINK_SECRET\n")
        })

        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.setEmbed((hit) => {
          const texts = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
          return {
            status: 200,
            wait: release.promise,
            body: {
              object: "list",
              data: texts.map((_, index) => ({
                object: "embedding",
                index,
                embedding: [1, 0, 0, 0],
              })),
            },
          }
        })

        const client = yield* MemoryEmbedding.makeClient({
          providerID: ProviderV2.ID.make("fixture"),
          model: "embed-race",
          endpoint: llm.url,
          dimensions: 4,
          key: "race-key",
          http: yield* HttpClient.HttpClient,
        }).pipe(Effect.provide(FetchHttpClient.layer))

        const state = { denied: false }
        const authorize = () =>
          state.denied
            ? Effect.fail(new MemorySearch.MemoryError({ message: "read permission revoked" }))
            : Effect.void

        const memory = yield* MemorySearch.make({ ...input, embedding: client, watch: false })
        const searching = yield* memory
          .search({ query: "semantic lookup", min_score: 0.5 }, authorize)
          .pipe(Effect.forkChild)
        yield* llm.waitEmbed(1)

        if (mutation === "revoke_permission") {
          state.denied = true
        }
        if (mutation === "clear_memory") {
          yield* Effect.promise(() =>
            MemoryMaintenance.clear(WorkspaceMemory.maintenance(directory, home, input), "workspace", true),
          )
        }
        if (mutation === "edit_file") {
          yield* Effect.promise(() => writeFile(target, "# Updated\n\nReplacement lexical content after edit.\n"))
        }
        if (mutation === "replace_symlink") {
          yield* Effect.promise(async () => {
            await rm(target)
            await symlink(path.join(outside, "outside.md"), target)
          })
        }

        release.resolve()
        const exit = yield* Fiber.await(searching)
        // Exactly 1 embedding request was sent; no leaked second request.
        expect(yield* llm.embedCalls).toBe(1)

        if (mutation === "revoke_permission" || mutation === "clear_memory") {
          expect(exit._tag).toBe("Failure")
        }
        if (mutation === "edit_file" || mutation === "replace_symlink") {
          expect(exit._tag).toBe("Success")
          if (exit._tag === "Success") {
            expect(JSON.stringify(exit.value.results)).not.toContain("Sensitive semantic note before mutation")
            expect(JSON.stringify(exit.value.results)).not.toContain("OUTSIDE_SYMLINK_SECRET")
          }
        }

        const sqliteFile = path.join(path.dirname(target), "search.sqlite")
        const exists = yield* Effect.promise(() => Bun.file(sqliteFile).exists())
        if (mutation === "clear_memory") {
          expect(exists).toBe(false)
          return
        }
        const db = new Database(sqliteFile)
        const vectors = db.query<{ path: string }, []>("SELECT path FROM memory_vectors").all()
        db.close()
        expect(vectors).toEqual([])
      }),
  )
}

