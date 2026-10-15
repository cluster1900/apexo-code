import { expect, test } from "bun:test"
import { fetch } from "bun"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { memoryOperationActions } from "./memory-operations"
import { MemoryActionError } from "./session-memory"

const migration = {
  kind: "carryover" as const,
  scope: "workspace" as const,
  sourceHash: "original-source",
  targetHash: "original-target",
  generation: "generation-1",
  available: true,
}
const recovery = {
  action: "clear" as const,
  scope: "global" as const,
  digest: "original-digest",
  generation: "generation-2",
  files: 3,
  plans: 1,
  available: true,
}

test("native operation adapter retains original previews/IDs, one Session, and bodyless cancellation", async () => {
  const requests: { method: string; path: string; body: unknown }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({
      method: request.method!,
      path: request.url!,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
    })
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "mop_reply" }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server address")
  try {
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch })
    const identities: string[] = []
    const owner = new AbortController()
    const actions = memoryOperationActions(
      client,
      async () => {
        identities.push("session")
        return "session"
      },
      owner.signal,
    )
    const signal = AbortSignal.timeout(5000)
    await actions.list(signal)
    await actions.get("mop_original", signal)
    await actions.migrationPreview("carryover", "workspace", signal)
    await actions.recoveryPreview("clear", "global", signal)
    await actions.execute({ kind: "migration", id: "mop_migrate", preview: migration }, signal)
    await actions.execute({ kind: "recovery", id: "mop_clear", preview: recovery }, signal)
    await actions.execute({ kind: "retry", id: "mop_retry", retryOf: "mop_original" }, signal)
    await actions.execute({ kind: "retry", id: "mop_retry", retryOf: "mop_original" }, signal)
    await actions.execute({ kind: "cancel", operationID: "mop_original" }, signal)
    await actions.execute({ kind: "flush", id: "mop_flush" }, signal)
    await actions.execute({ kind: "dream", id: "mop_dream" }, signal)
    expect(identities).toEqual(["session"])
    expect(requests.map((item) => item.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
    ])
    expect(requests.every((item) => item.path.startsWith("/api/session/session/memory/"))).toBe(true)
    expect(new URL(requests[2].path, "http://fixture").searchParams.get("kind")).toBe("carryover")
    expect(new URL(requests[3].path, "http://fixture").searchParams.get("action")).toBe("clear")
    expect(requests[4].body).toEqual({ id: "mop_migrate", preview: migration })
    expect(requests[5].body).toEqual({ id: "mop_clear", preview: recovery })
    expect(requests[6].body).toEqual({ id: "mop_retry", retryOf: "mop_original" })
    expect(requests[7]).toEqual(requests[6])
    expect(requests[8].body).toBeUndefined()
    expect(requests[9].body).toEqual({ id: "mop_flush" })
    expect(requests[10].body).toEqual({ id: "mop_dream" })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("operation reads join both owner and call cancellation with an explicit second signal", async () => {
  const child = Bun.spawn(
    [process.execPath, new URL("./fixtures/memory-operation-abort.ts", import.meta.url).pathname],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const deadline = setTimeout(() => child.kill(), 8000)
  try {
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, error }).toEqual({ code: 0, error: "" })
    expect(output.trim()).toBe("Native Memory owner and call cancellation verified")
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}, 10000)

test("operation owner cancellation while Session resolution is pending prevents the first HTTP request", async () => {
  const selected = Promise.withResolvers<string>()
  const entered = Promise.withResolvers<void>()
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url!)
    response.end("[]")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server address")
  try {
    const owner = new AbortController()
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch })
    const actions = memoryOperationActions(
      client,
      () => {
        entered.resolve()
        return selected.promise
      },
      owner.signal,
    )
    const pending = actions.list(AbortSignal.timeout(5000)).then(
      () => "resolved",
      () => "rejected",
    )
    await entered.promise
    owner.abort()
    selected.resolve("replacement")
    expect(await pending).toBe("rejected")
    expect(requests).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

for (const status of [403, 404, 409, 503]) {
  test(`native retry HTTP ${status} is visible without fallback or a fresh preview`, async () => {
    const requests: string[] = []
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* Consume the real POST body before replying. */
      }
      requests.push(request.url!)
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify({ message: "private cause /secret/path" }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    try {
      const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch })
      const actions = memoryOperationActions(client, async () => "session", AbortSignal.timeout(5000))
      const failure = await actions
        .execute({ kind: "retry", id: "mop_retry", retryOf: "mop_original" }, AbortSignal.timeout(5000))
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MemoryActionError)
      if (!(failure instanceof MemoryActionError)) throw new Error("Expected safe typed failure")
      expect(failure.message).not.toContain("/secret/path")
      expect(requests).toEqual(["/api/session/session/memory/retry"])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
