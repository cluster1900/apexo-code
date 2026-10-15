import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"

const trace = process.argv[2]!
const ready = process.argv[3]!
const mode = process.argv[4]!
const record = (data: Record<string, unknown>) =>
  appendFileSync(trace, JSON.stringify({ pid: process.pid, ...data }) + "\n")
const sockets = new Set<import("node:net").Socket>()
let sequence = 0
const server = createServer({ allowHalfOpen: true }, (socket) => {
  const id = ++sequence
  sockets.add(socket)
  record({ event: "connect", id })
  const behavior = readFileSync(mode, "utf8").trim()
  const connection = createMessageConnection(new StreamMessageReader(socket), new StreamMessageWriter(socket))
  socket.on("error", () => {})
  socket.once("end", () => setTimeout(() => socket.end(), 20))
  socket.once("close", () => {
    sockets.delete(socket)
    setImmediate(() => connection.dispose())
    record({ event: "close", id })
  })
  const documents = new Map<string, string>()
  connection.onRequest("initialize", async (params: unknown) => {
    record({ event: "initialize", id, params })
    if (behavior === "hang") await new Promise(() => {})
    if (behavior === "frame") {
      socket.write("Content-Length: 999999999\r\n\r\n")
      await new Promise(() => {})
    }
    return { capabilities: { hoverProvider: true, workspaceSymbolProvider: true, textDocumentSync: 2 } }
  })
  for (const method of ["initialized", "solution/open", "project/open"])
    connection.onNotification(method, (params: unknown) => record({ event: method, id, params }))
  connection.onNotification("textDocument/didOpen", (params: { textDocument: { uri: string; text: string } }) => {
    documents.set(params.textDocument.uri, params.textDocument.text)
  })
  connection.onNotification(
    "textDocument/didChange",
    (params: { textDocument: { uri: string }; contentChanges: { text: string }[] }) => {
      documents.set(params.textDocument.uri, params.contentChanges[0]?.text ?? "")
    },
  )
  connection.onRequest("textDocument/hover", async (params: { textDocument: { uri: string } }, token) => {
    const text = documents.get(params.textDocument.uri) ?? ""
    record({ event: "hover", id })
    if (text === "WAIT")
      await new Promise<void>((resolve) =>
        token.onCancellationRequested(() => {
          record({ event: "cancel", id })
          resolve()
        }),
      )
    return { contents: { kind: "plaintext", value: text } }
  })
  connection.onRequest("workspace/symbol", (params: { query: string }) => {
    if (params.query === "disconnect") socket.destroy()
    return []
  })
  connection.onRequest("shutdown", async () => {
    record({ event: "shutdown", id })
    if (behavior === "shutdown-hang") await new Promise(() => {})
    return null
  })
  // The independent fixture owns its process. Protocol exit ends only this client.
  connection.onNotification("exit", () => {
    record({ event: "exit", id })
    socket.end()
  })
  connection.listen()
})
server.listen({ port: 0, host: "127.0.0.1", backlog: 1 }, () => {
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("TCP address missing")
  record({ event: "start" })
  writeFileSync(ready, JSON.stringify({ port: address.port, pid: process.pid }))
})
process.on("SIGTERM", () => {
  sockets.forEach((socket) => socket.destroy())
  server.close(() => process.exit(0))
})
