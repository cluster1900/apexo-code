import { appendFileSync } from "node:fs"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
const record = (event: string, params?: unknown) =>
  process.env.MCP_RESOURCE_TRACE &&
  appendFileSync(process.env.MCP_RESOURCE_TRACE, JSON.stringify({ event, params, pid: process.pid }) + "\n")
const mode = process.env.MCP_RESOURCE_MODE_FILE
  ? (await Bun.file(process.env.MCP_RESOURCE_MODE_FILE).text()).trim()
  : (process.env.MCP_RESOURCE_MODE ?? "normal")
record("start")
if (mode === "fail") process.exit(2)
const server = new Server(
  { name: "resource-fixture", version: "1" },
  { capabilities: { ...(mode === "tools-only" ? {} : { resources: {} }), tools: {} } },
)
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
if (mode !== "tools-only")
  server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => {
    record("list", request.params)
    if (mode === "catalog-wait") {
      while (!extra.signal.aborted && !(await Bun.file(process.env.MCP_RESOURCE_TRACE + ".release").exists()))
        await Bun.sleep(10)
    }
    if (mode === "picker")
      return {
        resources: [
          { uri: "fixture://notes/one", name: "Unicode note" },
          { uri: "fixture://wait", name: "Held resource" },
          { uri: "fixture://unsupported", name: "Unsupported resource" },
        ],
      }
    if (mode === "error") throw new Error("private-server-details")
    if (mode === "cycle") return { resources: [], nextCursor: "repeat" }
    if (mode === "pages") return { resources: [], nextCursor: String(Number(request.params?.cursor ?? 0) + 1) }
    if (mode === "combined")
      return { resources: Array.from({ length: 600 }, (_, index) => ({ uri: `fixture://${index}`, name: "Item" })) }
    if (mode === "items")
      return { resources: Array.from({ length: 1001 }, (_, index) => ({ uri: `fixture://${index}`, name: "Item" })) }
    if (mode === "bytes")
      return { resources: [{ uri: "fixture://large", name: "Item", description: "x".repeat(1024 * 1024) }] }
    return request.params?.cursor === undefined
      ? { resources: [{ uri: "fixture://notes/one", name: "Notes" }], nextCursor: "" }
      : { resources: [{ uri: "fixture://notes/two", name: "Notes" }] }
  })
if (mode !== "tools-only")
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    record("templates", request.params)
    return request.params?.cursor === undefined
      ? {
          resourceTemplates: [{ uriTemplate: "fixture://notes/{name}{?query,values*,map*}", name: "Named note" }],
          nextCursor: "two",
        }
      : { resourceTemplates: [{ uriTemplate: "fixture://other/{id}", name: "Other note" }] }
  })
if (mode !== "tools-only")
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    record("read", request.params)
    if (request.params.uri === "fixture://wait")
      await new Promise<void>((resolve) => {
        extra.signal.addEventListener(
          "abort",
          () => {
            record("cancel")
            record("read-cleanup")
            resolve()
          },
          { once: true },
        )
      })
    if (request.params.uri === "fixture://held") {
      while (!extra.signal.aborted && !(await Bun.file(process.env.MCP_RESOURCE_TRACE + ".release").exists()))
        await Bun.sleep(10)
      if (extra.signal.aborted) record("read-cleanup")
    }
    if (request.params.uri === "fixture://media")
      return {
        contents: [
          {
            uri: "fixture://png",
            mimeType: "image/png",
            blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=",
          },
          {
            uri: "fixture://pdf",
            mimeType: "application/pdf",
            blob: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64"),
          },
        ],
      }
    if (request.params.uri === "fixture://empty") return { contents: [] }
    if (request.params.uri === "fixture://ten")
      return { contents: [{ uri: request.params.uri, text: "x".repeat(10 * 1024 * 1024) }] }
    if (request.params.uri === "fixture://large")
      return { contents: [{ uri: request.params.uri, text: "x".repeat(10 * 1024 * 1024 + 1) }] }
    if (request.params.uri === "fixture://invalid") return { contents: [{ uri: request.params.uri, blob: "invalid!" }] }
    if (request.params.uri === "fixture://many")
      return { contents: Array.from({ length: 129 }, () => ({ uri: request.params.uri, text: "x" })) }
    if (request.params.uri !== "fixture://unsupported")
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "text/plain",
            text: `${process.env.MCP_RESOURCE_LABEL ?? ""}UNICODE:雪:${request.params.uri}`,
          },
        ],
      }
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: `FIRST:${process.pid}:${request.params.uri}`,
          _meta: { fixture: "one" },
        },
        { uri: request.params.uri + "/image", mimeType: "image/png", blob: "iVBORw0KGgo=" },
        { uri: request.params.uri + "/second", mimeType: "text/plain", text: "SECOND" },
        {
          uri: request.params.uri + "/binary",
          mimeType: "application/octet-stream",
          blob: Buffer.from("BINARY").toString("base64"),
        },
      ],
    }
  })
await server.connect(new StdioServerTransport())
