import { describe, expect, test } from "bun:test"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { taskMessageDraft } from "@apexo/sdk/v2/task-message"
import type { TaskMessageInput, TaskMessageReceipt } from "@apexo/sdk/v2/client"

describe("operator Task message draft over real HTTP", () => {
  test("uncertain admission preserves immutable input, exact retry and passive promotion", async () => {
    const admitted = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const inputs: TaskMessageInput[] = []
    let receipt: TaskMessageReceipt | undefined
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        if (request.method === "GET") return receipt ? Response.json(receipt) : new Response(null, { status: 404 })
        const input: TaskMessageInput = await request.json()
        inputs.push(input)
        receipt ??= {
          inputID: input.inputID,
          taskID: "child",
          delivery: input.delivery ?? "steer",
          status: "admitted",
          admittedAt: 1,
        }
        admitted.resolve()
        if (inputs.length === 1) await release.promise
        return Response.json(receipt)
      },
    })
    const abort = new AbortController()
    try {
      const client = createApexoClient({ baseUrl: server.url.origin })
      const draft = taskMessageDraft(client, "parent", "child", 1)!
      draft.edit("Correction 中文", "queue")
      const sending = draft.send(abort.signal)
      await admitted.promise
      abort.abort()
      await sending
      expect(draft.state().issue).toBe("uncertain")
      const id = draft.state().input?.inputID
      draft.edit("Must not replace uncertain input", "interject")
      draft.next()
      expect(draft.state().text).toBe("Correction 中文")
      expect(draft.state().input?.inputID).toBe(id)
      expect(taskMessageDraft(client, "parent", "child", 1)).toBe(draft)
      await draft.send(new AbortController().signal)
      expect(inputs).toHaveLength(2)
      expect(inputs[0]).toEqual(inputs[1])
      expect(draft.state().receipt?.status).toBe("admitted")
      receipt = { ...receipt!, status: "promoted", promotedAt: 2 }
      await draft.refresh(new AbortController().signal)
      expect(draft.state().receipt?.status).toBe("promoted")
      expect(inputs).toHaveLength(2)
      draft.next()
      expect(draft.state().text).toBe("")
      expect(draft.state().input).toBeUndefined()
      expect(taskMessageDraft(client, "parent", "child", 2)).not.toBe(draft)
      expect(taskMessageDraft(client, "other", "child", 1)).not.toBe(draft)
      expect(taskMessageDraft(createApexoClient({ baseUrl: server.url.origin }), "parent", "child", 1)).not.toBe(draft)
    } finally {
      release.resolve()
      await server.stop(true)
    }
  })

  test("permission rejection retains editable text and UTF-8 overflow never posts", async () => {
    let posts = 0
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        await request.text()
        posts++
        return Response.json({ message: "private permission details" }, { status: 403 })
      },
    })
    try {
      const draft = taskMessageDraft(createApexoClient({ baseUrl: server.url.origin }), "parent", "child", 1)!
      draft.edit("文".repeat(10923))
      await draft.send(new AbortController().signal)
      expect(posts).toBe(0)
      expect(draft.state().issue).toBe("invalid")
      draft.edit("Allowed size")
      await draft.send(new AbortController().signal)
      expect(posts).toBe(1)
      expect(draft.state().issue).toBe("forbidden")
      expect(draft.state().input).toBeUndefined()
      expect(draft.state().text).toBe("Allowed size")
      draft.edit("Revised")
      expect(draft.state().text).toBe("Revised")
    } finally {
      await server.stop(true)
    }
  })
})

test("submitted wake reconciles its exact receipt across launch refresh without a fresh POST", async () => {
  let receipt: TaskMessageReceipt | undefined
  let posts = 0
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method === "GET") return receipt ? Response.json(receipt) : new Response(null, { status: 404 })
      posts++
      const input: TaskMessageInput = await request.json()
      receipt = {
        inputID: input.inputID,
        taskID: "continued-child",
        delivery: "steer",
        status: "promoted",
        admittedAt: 2,
        promotedAt: 3,
      }
      return Response.json(receipt)
    },
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.origin })
    const draft = taskMessageDraft(client, "parent", "continued-child", 1)!
    draft.edit("Continue completed Task")
    await draft.send(new AbortController().signal)
    const original = draft.state().receipt
    const next = taskMessageDraft(client, "parent", "continued-child", 2)!
    await next.refresh(new AbortController().signal)
    expect(next.state().receipt).toEqual(original)
    expect(posts).toBe(1)
    const missing = taskMessageDraft(client, "parent", "continued-child", 3)!
    receipt = undefined
    await missing.refresh(new AbortController().signal)
    missing.next()
    await missing.send(new AbortController().signal)
    expect(missing.state().input?.inputID).toBe(original?.inputID)
    expect(missing.state().receipt).toBeUndefined()
    expect(posts).toBe(1)
  } finally {
    await server.stop(true)
  }
})

test("a late POST from the retired launch cannot authorize another send", async () => {
  const arrived = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let posts = 0
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method === "GET") return new Response(null, { status: 404 })
      posts++
      const input: TaskMessageInput = await request.json()
      arrived.resolve()
      await release.promise
      return Response.json({
        inputID: input.inputID,
        taskID: "late-child",
        delivery: "steer",
        status: "promoted",
        admittedAt: 2,
        promotedAt: 3,
      })
    },
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.origin })
    const draft = taskMessageDraft(client, "parent", "late-child", 1)!
    draft.edit("Held wake")
    const sending = draft.send(new AbortController().signal)
    await arrived.promise
    const next = taskMessageDraft(client, "parent", "late-child", 2)!
    release.resolve()
    await sending
    await next.refresh(new AbortController().signal)
    next.next()
    await next.send(new AbortController().signal)
    expect(next.state().input?.text).toBe("Held wake")
    expect(next.state().receipt).toBeUndefined()
    expect(posts).toBe(1)
  } finally {
    release.resolve()
    await server.stop(true)
  }
})
