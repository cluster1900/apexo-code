import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

/** Real SDK peer shared by stdio, HTTP and connection-budget fixtures. */
export function formServer(options?: { stateless?: boolean }) {
  const validator = new AjvJsonSchemaValidator()
  const server = new Server(
    { name: "form-fixture", version: "1" },
    {
      capabilities: { tools: {}, resources: {} },
      jsonSchemaValidator: {
        getValidator<T>(schema: JsonSchemaType) {
          const validate = validator.getValidator<T>(schema)
          return (input: unknown) => {
            if (!input || typeof input !== "object" || Array.isArray(input)) return validate(input)
            // SDK's default AJV checks inherited properties; JSON form content contains own fields only.
            const content = { ...input }
            Object.setPrototypeOf(content, null)
            return validate(content)
          }
        },
      },
    },
  )
  const state = { calls: 0 }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "collect",
        description: "Collect typed deployment options",
        inputSchema: {
          type: "object",
          properties: { mode: { type: "string" }, before: { type: "number" }, after: { type: "number" } },
          additionalProperties: false,
        },
      },
    ],
  }))
  const elicit = (signal?: AbortSignal, special = false, relatedRequestId?: string | number) =>
    server.elicitInput(
      {
        message: "Choose deployment options",
        requestedSchema: special
          ? {
              type: "object",
              properties: {
                toString: { type: "number" as const, title: "Optional number" },
                valueOf: { type: "string" as const, title: "Optional text" },
                hasOwnProperty: { type: "boolean" as const, title: "Confirm", default: false },
                isPrototypeOf: { type: "string" as const, title: "Optional choice", enum: ["a", "b"] },
              },
              required: ["hasOwnProperty"],
            }
          : {
              type: "object",
              properties: {
                name: { type: "string", title: "Name", minLength: 1, maxLength: 40, default: "sample" },
                quantity: { type: "integer", title: "Quantity", minimum: 1, maximum: 10, default: 2 },
                ratio: { type: "number", title: "Ratio", minimum: 0, maximum: 1, default: 0.5 },
                confirm: { type: "boolean", title: "Confirm", default: false },
                environment: {
                  type: "string",
                  title: "Environment",
                  oneOf: [
                    { const: "dev", title: "Development" },
                    { const: "prod", title: "Production" },
                  ],
                  default: "dev",
                },
                regions: {
                  type: "array",
                  title: "Regions",
                  minItems: 1,
                  maxItems: 2,
                  items: {
                    anyOf: [
                      { const: "a", title: "A" },
                      { const: "b", title: "B" },
                    ],
                  },
                  default: ["a"],
                },
              },
              required: ["name", "quantity", "confirm", "regions"],
            },
      },
      { signal, timeout: 60_000, relatedRequestId },
    )
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const call = options?.stateless ? 1 : ++state.calls
    const args = request.params.arguments ?? {}
    if (typeof args.before === "number") await Bun.sleep(args.before)
    if (args.mode === "normal") return { content: [{ type: "text", text: JSON.stringify({ call, pid: process.pid }) }] }
    if (args.mode === "server_cancel") {
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), 100)
      await elicit(abort.signal).catch(() => {})
      clearTimeout(timer)
      return { content: [{ type: "text", text: "SERVER_CANCELLED" }] }
    }
    const replies =
      args.mode === "parallel"
        ? await Promise.allSettled([elicit(extra.signal), elicit(extra.signal)]).then((values) =>
            values.map((value) => value.status),
          )
        : args.mode === "repeat"
          ? [
              await elicit(extra.signal),
              ...(typeof args.after === "number" ? await Bun.sleep(args.after).then(() => []) : []),
              await elicit(extra.signal),
            ]
          : [await elicit(extra.signal, args.mode === "special", extra.requestId)]
    if (typeof args.after === "number") await Bun.sleep(args.after)
    return { content: [{ type: "text", text: JSON.stringify({ call, pid: process.pid, replies }) }] }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: "fixture://details", name: "Details" }],
  }))
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const reply = await elicit(extra.signal).then(
      () => "UNEXPECTED_FORM",
      () => "UNARMED_REJECTED",
    )
    return { contents: [{ uri: request.params.uri, text: reply }] }
  })
  return server
}

/** One fixture client, no MCP session header; correlate only the HTTP requests still in flight. */
export async function sessionlessFormServer() {
  const { WebStandardStreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
  )
  const peer = formServer({ stateless: true })
  const routes = new Map<string | number, InstanceType<typeof WebStandardStreamableHTTPServerTransport>>()
  const streams = new Set<InstanceType<typeof WebStandardStreamableHTTPServerTransport>>()
  const bridge: Transport = {
    async start() {},
    async close() {
      await Promise.all([...streams].map((transport) => transport.close()))
    },
    async send(message, options) {
      const id = options?.relatedRequestId ?? ("id" in message ? message.id : undefined)
      const transport = id === undefined ? undefined : routes.get(id)
      if (!transport) throw new Error("No in-flight HTTP request for SDK message")
      await transport.send(message, options)
      if (!("method" in message) && id !== undefined) routes.delete(id)
    },
  }
  await peer.connect(bridge)
  return {
    async handleRequest(request: Request) {
      // SDK requires a fresh sessionless transport for every HTTP request, including form replies.
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      streams.add(transport)
      transport.onclose = () => {
        streams.delete(transport)
      }
      transport.onmessage = (message, extra) => {
        if ("method" in message && "id" in message) routes.set(message.id, transport)
        bridge.onmessage?.(message, extra)
      }
      await transport.start()
      return transport.handleRequest(request)
    },
    close: () => peer.close(),
  }
}
