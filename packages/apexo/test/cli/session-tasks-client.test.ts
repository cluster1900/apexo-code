import { expect, test } from "bun:test"
import { fetch } from "bun"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import {
  taskActions,
  taskItem,
  processItem,
  TaskCancelError,
  ProcessActionError,
  ScheduleActionError,
} from "@apexo/tui/util/session-tasks"

for (const native of [true, false]) {
  test(`Task adapter routes ${native ? "native" : "compatibility"} list/output/cancel without model work`, async () => {
    const calls: string[] = []
    const bodies: string[] = []
    const item = native
      ? {
          id: "child",
          parentSessionID: "parent",
          description: "Inspect source",
          status: "interrupted",
          startedAt: 4,
          blockedReason: "process_restart",
        }
      : { id: "child", sessionID: "parent", title: "Inspect source", type: "task", status: "completed", started_at: 4 }
    const server = createServer((request, response) => {
      const url = new URL(request.url!, "http://localhost")
      calls.push(`${request.method} ${url.pathname}${url.search}`)
      if (url.pathname === "/global/health") {
        response
          .writeHead(native ? 404 : 200, { "content-type": "application/json" })
          .end(JSON.stringify({ healthy: true }))
        return
      }
      if (url.pathname === "/api/health") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ healthy: true }))
        return
      }
      if (url.pathname.endsWith("/process") || url.pathname.endsWith("/schedule")) {
        response.writeHead(200, { "content-type": "application/json" }).end("[]")
        return
      }
      if (request.method === "POST") {
        bodies.push(request.headers["content-length"] ?? "absent")
        response.writeHead(204).end()
        return
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(url.pathname.endsWith("/child") ? { ...item, output: "Line one\nLine two" } : [item]))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
      const actions = taskActions(
        client,
        () => "parent",
        async () => (native ? "native" : "compatibility"),
      )
      const signal = AbortSignal.timeout(5_000)
      const snapshot = await actions.list(signal)
      expect(snapshot.native).toBe(native)
      expect(snapshot.items[0]?.title).toBe("Inspect source")
      expect(snapshot.items[0]?.status).toBe(native ? "interrupted" : "completed")
      expect(snapshot.items[0]?.blockedReason).toBe(native ? "process_restart" : undefined)
      expect(
        (await actions.get({ id: "child", source: native ? "native-task" : "compatibility" }, signal)).output,
      ).toBe("Line one\nLine two")
      await actions.cancel({ id: "child", source: native ? "native-task" : "compatibility" }, signal)
      const prefix = native ? "/api/session/parent/task" : "/experimental/session/parent/task"
      expect(calls.filter((call) => !call.includes("health"))).toEqual([
        `GET ${prefix}${native ? "?limit=100" : ""}`,
        ...(native ? ["GET /api/session/parent/process?limit=100", "GET /api/session/parent/schedule"] : []),
        `GET ${prefix}/child`,
        `POST ${prefix}/child/cancel`,
      ])
      expect(bodies.every((value) => value === "absent" || value === "0")).toBe(true)
      expect(calls.some((call) => call.includes("health"))).toBe(false)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

for (const status of [409, 404, 503, 500]) {
  test(`native cancellation ${status} exposes safe feedback without retry`, async () => {
    let posts = 0
    const server = createServer((request, response) => {
      if (request.url === "/global/health") {
        response.writeHead(404).end()
        return
      }
      if (request.url === "/api/health") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ healthy: true }))
        return
      }
      posts++
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify({ message: "private server cause" }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
      const native = true
      const actions = taskActions(
        client,
        () => "parent",
        async () => (native ? "native" : "compatibility"),
      )
      const error = await actions.cancel({ id: "child", source: "native-task" }, AbortSignal.timeout(5_000)).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(error).toBeInstanceOf(TaskCancelError)
      if (!(error instanceof TaskCancelError)) throw new Error("Expected a typed cancellation error")
      expect(error.code).toBe(
        status === 409 ? "conflict" : status === 404 ? "missing" : status === 503 ? "unavailable" : "failed",
      )
      expect(error.message).not.toContain("private server cause")
      expect(posts).toBe(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

for (const background of [undefined, false, true]) {
  test(`native Task summary preserves background=${background}`, () => {
    const item = taskItem({
      id: "child",
      parentSessionID: "parent",
      description: "Inspect source",
      status: "running",
      startedAt: 4,
      ...(background === undefined ? {} : { background }),
    })
    expect(item.background).toBe(background === true)
  })
}

test("native Task and Process IDs route through explicit domains; waits are bounded and cancellation has no body", async () => {
  const calls: { method: string; url: string; body: string }[] = []
  const process = {
    id: "same-public-id",
    sessionID: "parent",
    kind: "monitor" as const,
    monitor: { persistent: true, timeoutMs: 0, accepted: 12, suppressed: 3, overloaded: true },
    description: "Live shell",
    status: "running" as const,
    background: true,
    startedAt: 20,
    truncated: true,
  }
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    calls.push({ method: request.method!, url: request.url!, body: Buffer.concat(chunks).toString() })
    const url = new URL(request.url!, "http://localhost")
    if (url.pathname.endsWith("/cancel")) {
      response.writeHead(204).end()
      return
    }
    if (url.pathname.endsWith("/schedule")) {
      response.writeHead(200, { "content-type": "application/json" }).end("[]")
      return
    }
    const data = url.pathname.endsWith("/process")
      ? [process]
      : url.pathname.endsWith("/task")
        ? [{ id: process.id, parentSessionID: "parent", description: "Subagent", status: "completed", startedAt: 10 }]
        : url.pathname.endsWith("/wait")
          ? { process: { ...process, output: "LIVE😀" }, timedOut: true }
          : { ...process, output: "LIVE😀" }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture address")
  try {
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
    const actions = taskActions(
      client,
      () => "parent",
      async () => "native",
    )
    const signal = AbortSignal.timeout(5000)
    const snapshot = await actions.list(signal)
    expect(snapshot.issues).toEqual([])
    expect(snapshot.items.map((item) => item.source)).toEqual(["native-process", "native-task"])
    expect(new Set(snapshot.items.map((item) => item.key)).size).toBe(2)
    const target = snapshot.items[0]!
    expect(target.childSessionID).toBeUndefined()
    expect(target.type).toBe("monitor")
    expect(target.monitor).toEqual(process.monitor)
    expect((await actions.get(target, signal)).output).toBe("LIVE😀")
    expect(await actions.wait(target, signal)).toMatchObject({
      timedOut: true,
      detail: { truncated: true, output: "LIVE😀", type: "monitor", monitor: process.monitor },
    })
    await actions.cancel(target, signal)
    expect(calls).toEqual([
      { method: "GET", url: "/api/session/parent/task?limit=100", body: "" },
      { method: "GET", url: "/api/session/parent/process?limit=100", body: "" },
      { method: "GET", url: "/api/session/parent/schedule", body: "" },
      { method: "GET", url: "/api/session/parent/process/same-public-id", body: "" },
      { method: "POST", url: "/api/session/parent/process/same-public-id/wait", body: '{"timeoutMs":10000}' },
      { method: "POST", url: "/api/session/parent/process/same-public-id/cancel", body: "" },
    ])
    expect(processItem({ ...process, status: "interrupted", blockedReason: "process_restart" })).toMatchObject({
      source: "native-process",
      status: "interrupted",
      blockedReason: "process_restart",
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

for (const failed of ["task", "process"] as const) {
  test(`unavailable ${failed} listing preserves the other domain without compatibility fallback`, async () => {
    const calls: string[] = []
    const server = createServer((request, response) => {
      calls.push(request.url!)
      if (request.url!.includes(`/${failed}?`)) {
        response.writeHead(503).end()
        return
      }
      if (request.url!.endsWith("/schedule")) {
        response.writeHead(200, { "content-type": "application/json" }).end("[]")
        return
      }
      const items = Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        parentSessionID: "parent",
        sessionID: "parent",
        kind: "shell",
        background: true,
        description: `Row ${index}`,
        status: "running",
        startedAt: index,
        truncated: false,
      }))
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(items))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
      const snapshot = await taskActions(
        client,
        () => "parent",
        async () => "native",
      ).list(AbortSignal.timeout(5000))
      expect(snapshot.items).toHaveLength(100)
      expect(snapshot.items[0]?.title).toBe("Row 99")
      expect(snapshot.issues).toEqual([failed === "task" ? "tasks" : "processes"])
      expect(calls).toHaveLength(3)
      expect(calls.every((url) => url.startsWith("/api/session/parent/"))).toBe(true)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

for (const status of [404, 409, 503, 500])
  for (const operation of ["get", "wait", "cancel"] as const) {
    test(`Process ${operation} ${status} exposes a safe localized code`, async () => {
      const server = createServer(async (request, response) => {
        for await (const _chunk of request) {
          /* Consume the real wait payload before the asynchronous reply. */
        }
        response.writeHead(status, { "content-type": "application/json" }).end('{"message":"private process cause"}')
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Missing fixture address")
      try {
        const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
        const error = await taskActions(
          client,
          () => "parent",
          async () => "native",
        )
          [operation]({ id: "proc", source: "native-process" }, AbortSignal.timeout(5000))
          .then(
            () => undefined,
            (error: unknown) => error,
          )
        expect(error).toBeInstanceOf(ProcessActionError)
        if (!(error instanceof ProcessActionError)) throw new Error("Expected process error")
        expect(error.code).toBe(
          status === 404 ? "missing" : status === 409 ? "conflict" : status === 503 ? "unavailable" : "failed",
        )
        expect(error.message).not.toContain("private process cause")
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })
  }

test("schedule rows keep their own identity and controls only change future intent", async () => {
  const calls: { method: string; url: string; body: string }[] = []
  let status: "active" | "paused" | "deleted" = "paused"
  let denied = false
  const summary = () => ({
    id: "same-public-id",
    sessionID: "parent",
    promptPreview: "Check build",
    prompt: "Check build\nwithout changing files",
    intervalSeconds: 60,
    durable: false,
    status,
    blockedReason: status === "paused" ? "restart_required" : undefined,
    createdAt: 1,
    expiresAt: 99_999,
    nextFireAt: 60_000,
    latestTaskID: "child",
    occurrenceStatus: "running",
  })
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    calls.push({ method: request.method!, url: request.url!, body: Buffer.concat(chunks).toString() })
    const url = new URL(request.url!, "http://localhost")
    if (url.pathname.endsWith("/task")) {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify([
          {
            id: "same-public-id",
            parentSessionID: "parent",
            description: "Running child",
            status: "running",
            startedAt: 2,
          },
        ]),
      )
      return
    }
    if (url.pathname.endsWith("/process")) {
      response.writeHead(200, { "content-type": "application/json" }).end("[]")
      return
    }
    if (request.method === "POST" || request.method === "DELETE") {
      if (denied) {
        response.writeHead(403, { "content-type": "application/json" }).end('{"cause":"SECRET_SCHEDULE_CAUSE"}')
        return
      }
      status = url.pathname.endsWith("/pause") ? "paused" : request.method === "DELETE" ? "deleted" : "active"
      response.writeHead(204).end()
      return
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(url.pathname.endsWith("/schedule") ? [summary()] : summary()))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture address")
  try {
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
    const actions = taskActions(
      client,
      () => "parent",
      async () => "native",
    )
    const signal = AbortSignal.timeout(5000)
    const snapshot = await actions.list(signal)
    expect(snapshot.issues).toEqual([])
    expect(snapshot.items).toHaveLength(2)
    expect(new Set(snapshot.items.map((item) => item.key)).size).toBe(2)
    expect(snapshot.items.filter((item) => item.status === "running")).toHaveLength(1)
    const schedule = snapshot.items.find((item) => item.source === "native-schedule")!
    expect(schedule.childSessionID).toBeUndefined()
    expect(schedule.schedule).toMatchObject({
      durable: false,
      blockedReason: "restart_required",
      latestTaskID: "child",
    })
    expect((await actions.get(schedule, signal)).output).toBe("Check build\nwithout changing files")
    expect(calls.every((call) => call.method === "GET")).toBe(true)
    expect((await actions.changeSchedule(schedule, "resume", signal)).status).toBe("active")
    expect((await actions.changeSchedule(schedule, "pause", signal)).status).toBe("paused")
    denied = true
    const error = await actions.changeSchedule(schedule, "resume", signal).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ScheduleActionError)
    expect(error).toMatchObject({ code: "forbidden" })
    expect(String(error)).not.toContain("SECRET_SCHEDULE_CAUSE")
    denied = false
    expect((await actions.changeSchedule(schedule, "delete", signal)).status).toBe("deleted")
    expect((await actions.get(schedule, signal)).status).toBe("deleted")
    const writes = calls.filter((call) => call.method !== "GET")
    expect(writes.map((call) => call.url)).toEqual([
      "/api/session/parent/schedule/same-public-id/resume",
      "/api/session/parent/schedule/same-public-id/pause",
      "/api/session/parent/schedule/same-public-id/resume",
      "/api/session/parent/schedule/same-public-id",
    ])
    expect(writes.map((call) => call.method)).toEqual(["POST", "POST", "POST", "DELETE"])
    expect(writes.every((call) => call.body === "")).toBe(true)
    expect(calls.some((call) => /prompt|\/cancel|\/command/u.test(call.url))).toBe(false)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("schedule discovery failure preserves Task data without fallback or model wake", async () => {
  const calls: string[] = []
  const server = createServer((request, response) => {
    calls.push(request.url!)
    if (request.url!.endsWith("/schedule")) {
      response.writeHead(503).end()
      return
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(
        request.url!.includes("/task?")
          ? JSON.stringify([
              { id: "child", parentSessionID: "parent", description: "Existing", status: "completed", startedAt: 1 },
            ])
          : "[]",
      )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture address")
  try {
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch, throwOnError: true })
    const actions = taskActions(
      client,
      () => "parent",
      async () => "native",
    )
    const snapshot = await actions.list(AbortSignal.timeout(5000))
    expect(snapshot.issues).toEqual(["schedules"])
    expect(snapshot.items.map((item) => item.source)).toEqual(["native-task"])
    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.startsWith("/api/session/parent/"))).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
