import { appendFileSync, readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"

const record = (data: Record<string, unknown>) => {
  if (process.env.LSP_NATIVE_TRACE)
    appendFileSync(
      process.env.LSP_NATIVE_TRACE,
      JSON.stringify({ pid: process.pid, time: Date.now(), name: process.env.LSP_POLICY_NAME, ...data }) + "\n",
    )
}
record({ event: "start", cwd: process.cwd() })
if (process.env.LSP_NATIVE_DESCENDANT) {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
    stdio: "ignore",
  })
  record({ event: "descendant", child: child.pid })
}
const mode = process.env.LSP_NATIVE_MODE_FILE ? readFileSync(process.env.LSP_NATIVE_MODE_FILE, "utf8").trim() : "ready"
if (mode === "fail") process.exit(1)
if (process.env.LSP_POLICY_NAME === "d_failed_restart") {
  const previous = readFileSync(process.env.LSP_NATIVE_TRACE!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.name === "d_failed_restart" && row.event === "start")
  if (previous.length > 1) process.exit(1)
}
const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
)
const docs = new Map<string, string>()
connection.onRequest("initialize", async (params: unknown) => {
  record({ event: "initialize", params })
  if (mode === "hang" || process.env.LSP_POLICY_NAME === "e_startup") await new Promise(() => {})
  return {
    capabilities: {
      positionEncoding: "utf-16",
      textDocumentSync: 2,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      implementationProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
    },
  }
})
connection.onNotification("initialized", () => record({ event: "initialized" }))
connection.onNotification(
  "textDocument/didOpen",
  (params: { textDocument: { uri: string; text: string; languageId: string } }) => {
    docs.set(params.textDocument.uri, params.textDocument.text)
    record({ event: "open", ...params.textDocument })
  },
)
connection.onNotification(
  "textDocument/didChange",
  (params: { textDocument: { uri: string }; contentChanges: { text: string }[] }) => {
    docs.set(params.textDocument.uri, params.contentChanges[0]?.text ?? "")
    record({ event: "change", params })
  },
)
for (const method of [
  "textDocument/definition",
  "textDocument/references",
  "textDocument/hover",
  "textDocument/implementation",
  "textDocument/documentSymbol",
  "workspace/symbol",
]) {
  connection.onRequest(method, async (params: { textDocument?: { uri: string }; query?: string }, token) => {
    record({ event: "request", method, params })
    const text = params.textDocument ? (docs.get(params.textDocument.uri) ?? "") : (params.query ?? "")
    if (text.includes("LSP_WAIT"))
      await new Promise<void>((resolve) =>
        token.onCancellationRequested(() => {
          record({ event: "cancel", method })
          resolve()
        }),
      )
    if (method === "textDocument/hover") return { contents: { kind: "plaintext", value: text } }
    return [
      {
        name: "fixture",
        kind: 12,
        location: {
          uri: params.textDocument?.uri ?? "file:///fixture",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
      },
    ]
  })
}
connection.onRequest("shutdown", async () => {
  record({ event: "shutdown" })
  if (process.env.LSP_POLICY_NAME === "f_shutdown") await new Promise(() => {})
  return null
})
connection.onNotification("exit", () => process.exit(0))
connection.listen()
