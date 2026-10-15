import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"
const trace = (method, params) =>
  appendFileSync(process.env.REFERENCE_MCP_TRACE, JSON.stringify({ pid: process.pid, method, params }) + "\n")
trace("start")
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const message = JSON.parse(line)
  trace(message.method, message.params)
  if (message.id === undefined) continue
  const result =
    message.method === "initialize"
      ? {
          protocolVersion: "2024-11-05",
          capabilities: { resources: {}, tools: {} },
          serverInfo: { name: "private-reference-resources", version: "1" },
        }
      : message.method === "tools/list"
        ? { tools: [] }
        : message.method === "resources/list"
          ? message.params?.cursor === "next"
            ? {
                resources: [
                  {
                    uri: "fixture://note/two",
                    name: "Second note",
                    mimeType: "text/plain",
                  },
                ],
              }
            : {
                resources: [
                  {
                    uri: "fixture://note/one",
                    name: "First note",
                    mimeType: "text/plain",
                  },
                ],
                nextCursor: "next",
              }
          : message.method === "resources/templates/list"
            ? {
                resourceTemplates: [
                  {
                    uriTemplate: "fixture://note/{name}{?view}",
                    name: "Named note",
                    mimeType: "text/plain",
                  },
                ],
              }
            : message.method === "resources/read"
              ? {
                  contents:
                    message.params.uri === "fixture://empty"
                      ? []
                      : [
                          {
                            uri: message.params.uri,
                            mimeType: "text/plain",
                            text: "MCP_REFERENCE_RETURNED_BYTES_é中文",
                            _meta: { origin: "private-read" },
                          },
                          {
                            uri: message.params.uri + "/second",
                            mimeType: "text/plain",
                            text: "MCP_REFERENCE_SECOND_BLOCK",
                          },
                          {
                            uri: message.params.uri + "/binary",
                            mimeType: "application/octet-stream",
                            blob: Buffer.from("UNSUPPORTED_REFERENCE_BINARY").toString("base64"),
                          },
                        ],
                }
              : undefined
  process.stdout.write(
    JSON.stringify(
      result === undefined
        ? {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unknown method" },
          }
        : { jsonrpc: "2.0", id: message.id, result },
    ) + "\n",
  )
}
