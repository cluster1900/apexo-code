import { expect, test } from "bun:test"
import { createApexoClient } from "@apexo/sdk/v2"
import { sessionTransport } from "@apexo/tui/transport/session"
import { nativeSessionTransport } from "@apexo/tui/transport/native-session"
import { terminalPermission, terminalRequestEvent } from "@apexo/tui/transport/native-session-events"
import { permissionAlwaysLines } from "../../src/cli/cmd/run/permission.shared"
import { Event } from "@apexo/schema/event"
import { SessionID } from "@apexo/schema/session-id"

for (const status of [401, 403, 500]) {
  test(`protocol selection preserves HTTP ${status} without native fallback`, async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)
        return new Response("unavailable", { status })
      },
    })
    try {
      const client = createApexoClient({ baseUrl: server.url.href })
      await expect(sessionTransport(client)(new AbortController().signal)).rejects.toThrow("Could not determine")
      expect(requests).toEqual(["/global/health"])
    } finally {
      await server.stop(true)
    }
  })
}

test("native selection stays native after missing Session and refuses a missing creation directory", async () => {
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      requests.push(path)
      if (path === "/api/health") return Response.json({ healthy: true, version: "test" })
      return new Response("missing", { status: 404 })
    },
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.href })
    const transport = await sessionTransport(client)(new AbortController().signal)
    expect(transport.kind).toBe("native")
    if (transport.kind !== "native") throw new Error("Expected native transport")
    await expect(transport.get(SessionID.create())).rejects.toBeDefined()
    await expect(transport.create()).rejects.toThrow("directory is required")
    expect(requests).toHaveLength(3)
    expect(requests[2]).toStartWith("/api/session/")
  } finally {
    await server.stop(true)
  }
})

test("native interaction presentation retains original ownership and saved approval lifetime", () => {
  const sessionID = SessionID.create()
  const request = terminalPermission({
    id: "per_test",
    sessionID,
    action: "bash",
    resources: ["printf test"],
    save: ["printf *"],
  })
  expect(permissionAlwaysLines(request)).toEqual(["Save approval for the following resources:", "- printf *"])
  const id = Event.ID.create()
  const event = terminalRequestEvent({
    id,
    type: "question.v2.asked",
    data: {
      id: "que_test",
      sessionID,
      questions: [
        {
          header: "Review",
          question: "Plan bytes\nline 2",
          purpose: "plan_approval",
          custom: false,
          options: [{ label: "Approve", description: "Continue" }],
        },
      ],
    },
  })
  expect(event?.id).toBe(id)
  expect(event?.type).toBe("question.asked")
  if (event?.type !== "question.asked") throw new Error("Expected question")
  expect(event.properties.sessionID).toBe(sessionID)
  expect(event.properties.questions[0]).toMatchObject({
    purpose: "plan_approval",
    custom: false,
    question: "Plan bytes\nline 2",
  })
  expect(terminalRequestEvent({ type: "question.v2.asked", data: {} })).toBeUndefined()
})

test("native requests preserve the terminal client's lifetime cancellation", async () => {
  const started = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  const controller = new AbortController()
  const server = Bun.serve({
    port: 0,
    fetch() {
      started.resolve()
      return response.promise
    },
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.href, signal: controller.signal })
    const transport = nativeSessionTransport(client)
    const pending = transport.get(SessionID.create())
    await started.promise
    controller.abort()
    response.resolve(Response.json({ data: {} }))
    await expect(pending).rejects.toBeDefined()
  } finally {
    controller.abort()
    response.resolve(new Response(null, { status: 503 }))
    await server.stop(true)
  }
})

for (const direction of ["owner", "call"] as const) {
  test(`native per-call requests also preserve ${direction} cancellation`, async () => {
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const owner = new AbortController()
    const call = new AbortController()
    const server = Bun.serve({
      port: 0,
      fetch() {
        started.resolve()
        return response.promise
      },
    })
    try {
      const client = createApexoClient({ baseUrl: server.url.href, signal: owner.signal })
      const transport = nativeSessionTransport(client, undefined, owner.signal)
      const pending = transport.get(SessionID.create(), call.signal)
      await started.promise
      if (direction === "owner") owner.abort()
      if (direction === "call") call.abort()
      response.resolve(Response.json({ data: {} }))
      await expect(pending).rejects.toBeDefined()
      expect(direction === "owner" ? call.signal.aborted : owner.signal.aborted).toBe(false)
    } finally {
      owner.abort()
      call.abort()
      response.resolve(new Response(null, { status: 503 }))
      await server.stop(true)
    }
  })
}

for (const mode of ["native", "compatibility"] as const) {
  test(`explicit ${mode} choice is cached and never probes or changes after a failed operation`, async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)
        return new Response("unavailable", { status: 503 })
      },
    })
    try {
      const client = createApexoClient({ baseUrl: server.url.href })
      const select = sessionTransport(client, undefined, mode)
      const owner = new AbortController()
      const first = await select(owner.signal)
      expect(first.kind).toBe(mode)
      expect(requests).toEqual([])
      const id = SessionID.create()
      await expect(
        first.kind === "native" ? first.get(id) : first.client.session.get({ sessionID: id }, { throwOnError: true }),
      ).rejects.toBeDefined()
      expect(await select(owner.signal)).toBe(first)
      expect(requests).toEqual([mode === "native" ? `/api/session/${id}` : `/session/${id}`])
    } finally {
      await server.stop(true)
    }
  })
}

test("auto still selects compatibility on a mixed server and shares the selection", async () => {
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      return Response.json({ healthy: true, version: "test" })
    },
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.href })
    const select = sessionTransport(client)
    const signal = new AbortController().signal
    const [first, second] = await Promise.all([select(signal), select(signal)])
    expect(first.kind).toBe("compatibility")
    expect(second).toBe(first)
    expect(requests).toEqual(["/global/health"])
  } finally {
    await server.stop(true)
  }
})

test("native /loop expands discovered prompt once and uses ordinary durable admission", async () => {
  const calls: { path: string; method: string; body: unknown }[] = []
  const sessionID = SessionID.create()
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      calls.push({ path, method: request.method, body: request.method === "POST" ? await request.json() : undefined })
      if (path === "/api/command") return Response.json({ data: [{ name: "loop", template: "LOOP:\n$ARGUMENTS" }] })
      return Response.json({ data: { sessionID, id: "message", admittedSeq: 1, state: "pending" } })
    },
  })
  try {
    const transport = nativeSessionTransport(createApexoClient({ baseUrl: server.url.href }), "/work")
    await transport.admit({
      sessionID,
      prompt: { text: "/loop 5m $ARGUMENTS $&\nnext line" },
      delivery: "queue",
      resume: false,
    })
    expect(calls).toEqual([
      { path: "/api/command", method: "GET", body: undefined },
      {
        path: `/api/session/${sessionID}/prompt`,
        method: "POST",
        body: { prompt: { text: "LOOP:\n5m $ARGUMENTS $&\nnext line" }, delivery: "queue", resume: false },
      },
    ])
    await transport.admit({ sessionID, prompt: { text: "ordinary" }, resume: false })
    expect(calls).toHaveLength(3)
    expect(calls[2]?.body).toEqual({ prompt: { text: "ordinary" }, resume: false })
  } finally {
    await server.stop(true)
  }
})
