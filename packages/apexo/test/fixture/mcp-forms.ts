import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

/** Real SDK peer shared by stdio, HTTP and connection-budget fixtures. */
export function formServer(options?: { stateless?: boolean }) {
  const server = new Server({ name: "form-fixture", version: "1" }, { capabilities: { tools: {}, resources: {} } })
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
  const elicit = (signal?: AbortSignal) =>
    server.elicitInput(
      {
        message: "Choose deployment options",
        requestedSchema: {
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
      { signal, timeout: 60_000 },
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
          : [await elicit(extra.signal)]
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
