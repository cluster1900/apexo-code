import { createServer } from "node:http"
import { once } from "node:events"
import { expect, test } from "bun:test"
import {
  sessionResponse,
  sessionTrace,
  sessionTranscript,
  sessionUsage,
  type SessionExportData,
} from "./session-export"

const assistant = (id: string, parentID: string, modelID: string, input: number, output: number, cost: number) => ({
  info: {
    id,
    sessionID: "ses_1",
    role: "assistant",
    parentID,
    providerID: "xai",
    modelID,
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost,
    tokens: { input, output, reasoning: 1, cache: { read: 2, write: 3 } },
    time: { created: 2_000, completed: 3_000 },
  },
  parts: [{ id: `${id}_p`, sessionID: "ses_1", messageID: id, type: "text", text: `answer ${id}` }],
})

const user = (id: string, text: string, synthetic = false) => ({
  info: {
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: 1_000 },
    agent: "build",
    model: { providerID: "xai", modelID: "grok" },
  },
  parts: [{ id: `${id}_p`, sessionID: "ses_1", messageID: id, type: "text", text, synthetic }],
})

const data = {
  info: { id: "ses_1", title: "Demo", directory: "/repo", time: { created: 1_000, updated: 4_000 } },
  messages: [
    user("msg_u1", "first question"),
    assistant("msg_a1", "msg_u1", "grok", 10, 5, 0.01),
    assistant("msg_a2", "msg_u1", "grok-mini", 4, 2, 0.002),
    user("msg_u2", "hidden context", true),
    user("msg_u3", "second question"),
    assistant("msg_a3", "msg_u3", "grok", 6, 3, 0.005),
  ],
} as unknown as SessionExportData

test("sessionUsage totals turns, calls and per-model tokens like `apexo usage`", () => {
  const usage = sessionUsage(data)
  expect(usage.turns).toBe(2)
  expect(usage.calls).toBe(3)
  expect(usage.inputTokens).toBe(20)
  expect(usage.outputTokens).toBe(10)
  expect(usage.cacheReadTokens).toBe(6)
  expect(usage.costUsd).toBeCloseTo(0.017)
  expect(usage.models.map((model) => [model.modelID, model.calls, model.inputTokens])).toEqual([
    ["grok", 2, 16],
    ["grok-mini", 1, 4],
  ])
})

test("sessionTranscript keeps visible text and drops synthetic parts", () => {
  const text = sessionTranscript(data)
  expect(text.startsWith("# Demo\n")).toBe(true)
  expect(text).toContain("## User\n\nfirst question")
  expect(text).toContain("## Assistant\n\nanswer msg_a3")
  expect(text).not.toContain("hidden context")
})

test("sessionTrace bundles summary, events, history and metadata", () => {
  const trace = sessionTrace(data, "apexo-desktop", new Date("2026-01-01T00:00:00Z"))
  expect(trace.summary.info).toMatchObject({ id: "ses_1", title: "Demo", cwd: "/repo" })
  expect(trace.summary.num_messages).toBe(6)
  expect(trace.summary.total_input_tokens).toBe(20)
  expect(trace.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6])
  expect(trace.chat_history).toBe(data.messages)
  expect(trace.export_metadata).toEqual({
    session_id: "ses_1",
    exported_at: "2026-01-01T00:00:00.000Z",
    exporter: "apexo-desktop",
  })
})

test("sessionResponse picks the Nth-latest assistant response with text", () => {
  const toolOnly = {
    ...assistant("msg_a4", "msg_u3", "grok", 1, 1, 0),
    parts: [{ id: "msg_a4_t", sessionID: "ses_1", messageID: "msg_a4", type: "tool", tool: "read" }],
  }
  const withTool = { ...data, messages: [...data.messages, toolOnly] } as unknown as SessionExportData
  expect(sessionResponse(withTool)).toBe("answer msg_a3")
  expect(sessionResponse(withTool, 2)).toBe("answer msg_a2")
  expect(sessionResponse(withTool, 3)).toBe("answer msg_a1")
  expect(sessionResponse(withTool, 4)).toBeUndefined()
  expect(sessionResponse(withTool, 0)).toBeUndefined()
})

test("session import uses selected server auth, encoded directory and platform transport", async () => {
  const { importSessionExport } = await import("./session-export")
  const requests: { authorization: string | null; directory: string | null; body: unknown }[] = []
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*")
    response.setHeader("access-control-allow-methods", "POST, OPTIONS")
    response.setHeader("access-control-allow-headers", "authorization, content-type, x-apexo-directory")
    if (request.method === "OPTIONS") {
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const authorization = request.headers.authorization ?? null
    requests.push({
      authorization,
      directory: String(request.headers["x-apexo-directory"]),
      body: JSON.parse(Buffer.concat(chunks).toString()),
    })
    response.setHeader("content-type", "application/json")
    response.statusCode = authorization === `Basic ${btoa("custom:import-password")}` ? 200 : 401
    response.end(JSON.stringify(data.info))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP server")
  try {
    const calls: string[] = []
    const transport: typeof fetch = Object.assign(
      (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(url))
        return fetch(`http://127.0.0.1:${address.port}`, init)
      },
      { preconnect: fetch.preconnect },
    )
    const imported = await importSessionExport({
      server: { url: "http://selected-server", username: "custom", password: "import-password" },
      fetch: transport,
      directory: "/project/中文 space",
      data,
    })
    expect(imported).toEqual(data.info)
    expect(calls).toEqual(["http://selected-server/session"])
    expect(requests).toEqual([
      {
        authorization: `Basic ${btoa("custom:import-password")}`,
        directory: encodeURIComponent("/project/中文 space"),
        body: { title: data.info.title, info: data.info, messages: data.messages },
      },
    ])
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
