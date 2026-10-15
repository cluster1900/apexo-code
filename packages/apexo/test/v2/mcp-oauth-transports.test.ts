import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { networkInterfaces, tmpdir } from "node:os"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MCP } from "@apexo/core/mcp"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"

const privateAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (entry) => entry?.family === "IPv4" && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(entry.address),
  )?.address
for (const mode of ["sse", "http"] as const)
  test.skipIf(mode === "http" && !privateAddress)(
    `ordinary unauthenticated ${mode} remains usable`,
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "apexo-oauth-transport-"))
      const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
      const received: { method: string; authorization: string | null }[] = []
      const server = Bun.serve({
        hostname: mode === "http" ? privateAddress! : "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (mode === "sse" && url.pathname === "/mcp") {
            if (request.method !== "GET") return new Response(null, { status: 405 })
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  streams.add(controller)
                  controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /messages?sessionId=fixture\n\n"))
                },
                cancel() {},
              }),
              { headers: { "content-type": "text/event-stream" } },
            )
          }
          if (request.method === "DELETE") return new Response(null, { status: 200 })
          if (request.method !== "POST") return new Response(null, { status: 405 })
          const body = (await request.json()) as { id?: number; method: string }
          received.push({
            method: body.method,
            authorization: request.headers.get("authorization"),
          })
          if (body.id === undefined) return new Response(null, { status: 202 })
          const response = {
            jsonrpc: "2.0",
            id: body.id,
            result:
              body.method === "initialize"
                ? {
                    protocolVersion: "2025-11-25",
                    capabilities: { tools: {} },
                    serverInfo: { name: "transport", version: "1" },
                  }
                : { tools: [] },
          }
          if (mode === "http") return Response.json(response)
          for (const stream of streams)
            stream.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(response)}\n\n`))
          return new Response(null, { status: 202 })
        },
      })
      const directory = path.join(root, "project")
      await Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          mcp: {
            servers: {
              ordinary: {
                type: "remote",
                url: `${server.url.origin}/mcp`,
                timeout: { startup: 1000 },
              },
            },
          },
        }),
      )
      const layer = AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node]), [
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({
              data: path.join(root, "data"),
              config: path.join(root, "config"),
              home: root,
            }),
          ),
        ],
        [SessionExecution.node, SessionExecution.noopLayer],
      ])
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const locations = yield* LocationServiceMap.Service
            const session = yield* sessions.create({
              location: { directory: AbsolutePath.make(directory) },
            })
            yield* Effect.gen(function* () {
              const mcp = yield* MCP.Service
              expect((yield* mcp.status).ordinary.status).toBe("connected")
              if (mode === "http") expect((yield* mcp.status).ordinary.authentication?.supported).toBe(false)
              expect(received.map((x) => x.method)).toContain("tools/list")
              expect(received.every((x) => x.authorization === null)).toBe(true)
            }).pipe(Effect.provide(locations.get(session.location)))
          }).pipe(Effect.provide(layer), Effect.scoped),
        )
      } finally {
        for (const stream of streams) {
          try {
            stream.close()
          } catch {}
        }
        await server.stop(true)
        await rm(root, { recursive: true, force: true })
      }
    },
    15000,
  )
