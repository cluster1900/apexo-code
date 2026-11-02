import { createServer } from "node:http"
import { expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi, markNativeSession } from "./server-compat"
import { adaptLegacySyncEvent } from "./server-event"

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

test("v1 compatible api routes sandboxed and forked native sessions to v2 prompt instead of legacy prompt_async", async () => {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*")
    response.setHeader("access-control-allow-headers", "authorization, content-type, x-apexo-directory")
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
    if (url.pathname === "/api/session" && request.method === "POST") {
      response.end(
        JSON.stringify({
          data: {
            id: "ses_sandbox",
            projectID: "prj_1",
            title: "Sandbox session",
            location: { directory: "/work" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        }),
      )
      return
    }
    if (url.pathname.endsWith("/fork") && request.method === "POST") {
      response.end(
        JSON.stringify({
          data: {
            id: "ses_forked",
            projectID: "prj_1",
            title: "Forked session",
            location: { directory: "/work" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 2, updated: 2 },
          },
        }),
      )
      return
    }
    if (url.pathname.endsWith("/reply") && request.method === "POST") {
      response.writeHead(204).end()
      return
    }
    response.end(
      JSON.stringify({
        data: {
          admittedSeq: 1,
          id: "msg_1",
          sessionID: "ses_sandbox",
          timeCreated: 10,
          delivery: "steer",
          prompt: { text: "first message" },
        },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture listener")
  const connection = { url: `http://127.0.0.1:${address.port}` }
  const api = createCompatibleApi({
    protocol: Promise.resolve("v1"),
    current: createApiForServer({ server: connection }),
    legacy: (directory) => createSdkForServer({ server: connection, directory, throwOnError: true }),
    directory: "/work",
  })
  try {
    const created = await api.session.create({
      location: { directory: "/work" },
      commandSandbox: "npm-only",
    })
    expect(created.id).toBe("ses_sandbox")
    markNativeSession(created.id)
    await api.session.prompt({ sessionID: created.id, id: "msg_1", text: "first message" })
    const forked = await api.session.fork({ sessionID: created.id })
    expect(forked.id).toBe("ses_forked")
    await api.session.prompt({ sessionID: forked.id, id: "msg_2", text: "after fork" })
    await api.permission.reply({
      sessionID: created.id,
      requestID: "per_1",
      reply: "once",
    })
    expect(requests.map((r) => r.path)).toEqual([
      "/api/session",
      "/api/session/ses_sandbox/prompt",
      "/api/session/ses_sandbox/fork",
      "/api/session/ses_forked/prompt",
      "/api/session/ses_sandbox/permission/per_1/reply",
    ])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("adaptLegacySyncEvent bridges ephemeral permission.v2 and question.v2 events for Desktop UI", () => {
  const asked = adaptLegacySyncEvent({
    id: "evt_perm_1",
    type: "permission.v2.asked",
    properties: {
      id: "per_1",
      sessionID: "ses_sandbox",
      action: "edit",
      resources: ["src/index.ts"],
      save: ["src/**"],
      metadata: { filepath: "src/index.ts" },
      source: { type: "tool", messageID: "msg_asst_1", callID: "call_1" },
    },
  })
  expect(asked).toMatchObject({
    id: "evt_perm_1",
    type: "permission.asked",
    properties: {
      id: "per_1",
      sessionID: "ses_sandbox",
      permission: "edit",
      patterns: ["src/index.ts"],
      always: ["src/**"],
      metadata: { filepath: "src/index.ts" },
      tool: { messageID: "msg_asst_1", callID: "call_1" },
    },
  })

  const replied = adaptLegacySyncEvent({
    id: "evt_perm_2",
    type: "permission.v2.replied",
    properties: {
      sessionID: "ses_sandbox",
      requestID: "per_1",
      reply: "once",
    },
  })
  expect(replied).toMatchObject({
    id: "evt_perm_2",
    type: "permission.replied",
    properties: {
      sessionID: "ses_sandbox",
      requestID: "per_1",
      reply: "once",
    },
  })
})

test("v2 session reducer projects session.next.* turn and history copy events without losing assistant content", async () => {
  const { createV2SessionReducer } = await import("@/context/server-session-v2-reducer")
  const { normalizeSessionMessages } = await import("@/utils/session-message")
  const reducer = createV2SessionReducer()
  type EventInput = Parameters<typeof reducer.reduce>[1]
  const asEvent = (value: unknown) => value as EventInput

  let messages: Parameters<typeof reducer.reduce>[0] = []
  const apply = (raw: unknown) => {
    const next = reducer.reduce(messages, asEvent(raw))
    expect(next).toBeDefined()
    messages = next!.messages
    return next!
  }

  apply({
    id: "evt_1",
    type: "session.next.prompted",
    created: 100,
    data: {
      sessionID: "ses_next",
      timestamp: 100,
      messageID: "msg_user_1",
      prompt: { text: "ping" },
    },
  })
  apply({
    id: "evt_2",
    type: "session.next.step.started",
    created: 110,
    data: {
      sessionID: "ses_next",
      timestamp: 110,
      assistantMessageID: "msg_asst_1",
      agent: "build",
      model: { id: "grok-4", providerID: "xai" },
    },
  })
  apply({
    id: "evt_3",
    type: "session.next.text.started",
    created: 120,
    data: {
      sessionID: "ses_next",
      timestamp: 120,
      assistantMessageID: "msg_asst_1",
      textID: "txt_1",
    },
  })
  apply({
    id: "evt_4",
    type: "session.next.text.delta",
    created: 130,
    data: {
      sessionID: "ses_next",
      timestamp: 130,
      assistantMessageID: "msg_asst_1",
      textID: "txt_1",
      delta: "pong",
    },
  })
  apply({
    id: "evt_5",
    type: "session.next.text.ended",
    created: 140,
    data: {
      sessionID: "ses_next",
      timestamp: 140,
      assistantMessageID: "msg_asst_1",
      textID: "txt_1",
      text: "pong!",
    },
  })
  const finalStep = apply({
    id: "evt_6",
    type: "session.next.step.ended",
    created: 150,
    data: {
      sessionID: "ses_next",
      timestamp: 150,
      assistantMessageID: "msg_asst_1",
      finish: "stop",
      cost: 0,
      tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  })

  const normalized = normalizeSessionMessages("ses_next", finalStep.messages)
  expect(normalized.messages.map((m) => ({ id: m.id, role: m.role }))).toEqual([
    { id: "msg_user_1", role: "user" },
    { id: "msg_asst_1", role: "assistant" },
  ])
  expect(normalized.parts.get("msg_asst_1")).toEqual([
    {
      id: "msg_asst_1:text:0",
      sessionID: "ses_next",
      messageID: "msg_asst_1",
      type: "text",
      text: "pong!",
      synthetic: undefined,
    },
  ])
})
