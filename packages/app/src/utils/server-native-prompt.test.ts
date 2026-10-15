import { createServer } from "node:http"
import { expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi } from "./server-compat"

test("native prompt adapts the current wire contract and preserves admission controls", async () => {
  const requests: { path: string; authorization: string | null; body: unknown }[] = []
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*")
    response.setHeader("access-control-allow-headers", "authorization, content-type")
    response.setHeader("access-control-allow-methods", "POST, OPTIONS")
    if (request.method === "OPTIONS") {
      response.writeHead(204).end()
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ path: request.url!, authorization: request.headers.authorization ?? null, body })
    response.setHeader("content-type", "application/json")
    if (request.url!.includes("missing")) {
      response.writeHead(404).end(JSON.stringify({ message: "Session not found" }))
      return
    }
    response.end(
      JSON.stringify({
        data: {
          admittedSeq: 42,
          id: "msg_input",
          sessionID: "ses_input",
          timeCreated: 123,
          delivery: "queue",
          prompt: { text: "hello" },
        },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("HTTP fixture address unavailable")
  const connection = { url: `http://127.0.0.1:${address.port}`, username: "fixture", password: "secret" }
  const api = createCompatibleApi({
    protocol: Promise.resolve("v2"),
    current: createApiForServer({ server: connection }),
    legacy: (directory) => createSdkForServer({ server: connection, directory, throwOnError: true }),
  })
  const files = [
    { uri: "file:///workspace/example.txt", name: "example.txt", mention: { start: 0, end: 7, text: "example" } },
  ]
  const agents = [{ name: "reviewer", mention: { start: 8, end: 17, text: "@reviewer" } }]
  try {
    const result = await api.session.prompt({
      sessionID: "ses_input",
      id: "msg_input",
      text: "hello",
      files,
      agents,
      delivery: "queue",
      resume: false,
    })
    expect(requests[0]).toEqual({
      path: "/api/session/ses_input/prompt",
      authorization: `Basic ${btoa("fixture:secret")}`,
      body: {
        id: "msg_input",
        prompt: {
          text: "hello",
          files: [{ uri: files[0].uri, name: files[0].name, source: files[0].mention }],
          agents: [{ name: agents[0].name, source: agents[0].mention }],
        },
        delivery: "queue",
        resume: false,
      },
    })
    expect(result.admittedSeq).toBe(42)
    expect(result.id).toBe("msg_input")
    expect(result.delivery).toBe("queue")
    await expect(api.session.prompt({ sessionID: "missing", text: "hello" })).rejects.toBeDefined()
    expect(requests).toHaveLength(2)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test("native loop command and raw slash input share ordinary prompt admission", async () => {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*")
    response.setHeader("access-control-allow-headers", "authorization, content-type")
    response.setHeader("access-control-allow-methods", "POST, GET, OPTIONS")
    if (request.method === "OPTIONS") {
      response.writeHead(204).end()
      return
    }
    const url = new URL(request.url!, "http://localhost")
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({
      method: request.method!,
      path: url.pathname,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
    })
    response.setHeader("content-type", "application/json")
    if (url.pathname === "/api/command") {
      response.end(JSON.stringify({ data: [{ name: "loop", template: "LOOP:\n$ARGUMENTS" }] }))
      return
    }
    response.end(
      JSON.stringify({
        data: {
          admittedSeq: 1,
          id: "msg_loop",
          sessionID: "ses_loop",
          timeCreated: 1,
          delivery: "steer",
          prompt: { text: "admitted" },
        },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture listener")
  const connection = { url: `http://127.0.0.1:${address.port}` }
  const api = createCompatibleApi({
    protocol: Promise.resolve("v2"),
    current: createApiForServer({ server: connection }),
    legacy: (directory) => createSdkForServer({ server: connection, directory, throwOnError: true }),
    directory: "/work",
  })
  try {
    await api.session.command({
      sessionID: "ses_loop",
      id: "msg_loop",
      command: "loop",
      arguments: "5m $& $ARGUMENTS\nline two",
    })
    expect(requests).toEqual([
      { method: "GET", path: "/api/command", body: undefined },
      {
        method: "POST",
        path: "/api/session/ses_loop/prompt",
        body: { id: "msg_loop", prompt: { text: "LOOP:\n5m $& $ARGUMENTS\nline two" } },
      },
    ])
    await api.session.prompt({ sessionID: "ses_loop", text: "/loop\n1h inspect", delivery: "queue", resume: false })
    expect(requests[3]).toEqual({
      method: "POST",
      path: "/api/session/ses_loop/prompt",
      body: { prompt: { text: "LOOP:\n1h inspect" }, delivery: "queue", resume: false },
    })
    expect(requests).toHaveLength(4)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
