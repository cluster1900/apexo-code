import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { McpElicitation } from "@apexo/schema/mcp-elicitation"
import { SessionID } from "@apexo/schema/session-id"
import type { McpElicitationRequest } from "@apexo/sdk/v2/client"
import { createApexoClient } from "@apexo/sdk/v2/client"
import {
  elicitationContent,
  elicitationDefaults,
  elicitationValue,
  watchMcpElicitations,
} from "@apexo/sdk/v2/mcp-elicitation"

const request = (sessionID: string, id = McpElicitation.ID.create()) => ({
  id,
  sessionID,
  assistantMessageID: "message",
  toolCallID: "call",
  server: "forms",
  message: "Choices",
  status: "pending" as const,
  createdAt: Date.now(),
  deadlineAt: Date.now() + 60000,
  form: {
    fields: [
      { name: "quantity", title: "Quantity", type: "integer" as const, required: true, default: 2 },
      { name: "confirm", title: "Confirm", type: "boolean" as const, required: true, default: false },
      {
        name: "choice",
        title: "Choice",
        type: "select" as const,
        required: true,
        options: [{ value: "", title: "Empty is valid" }],
        default: "",
      },
      {
        name: "regions",
        title: "Regions",
        type: "multi" as const,
        required: true,
        options: [{ value: "a", title: "A" }],
        default: ["a"],
      },
    ],
  },
})

test("typed drafts preserve false, valid empty enums, array defaults and explicit decimal parsing", () => {
  const form = request(SessionID.make(`ses_${"1".repeat(26)}`))
  const values = elicitationDefaults(form)
  expect(elicitationValue(values, "toString")).toBeUndefined()
  expect(elicitationValue(values, "valueOf")).toBeUndefined()
  expect(values).toEqual({ quantity: 2, confirm: false, choice: "", regions: ["a"] })
  expect(values.regions).not.toBe(form.form.fields[3].default)
  expect(elicitationContent(form, { ...values, quantity: "3e0" })).toEqual({ content: { ...values, quantity: 3 } })
  expect(elicitationContent(form, { ...values, quantity: "Infinity" })).toEqual({ invalid: "quantity" })
  expect(elicitationContent(form, { ...values, quantity: "0x10" })).toEqual({ invalid: "quantity" })
})

test("optional prototype-named fields stay absent until explicitly edited", () => {
  const form = {
    ...request(SessionID.make(`ses_${"1".repeat(26)}`)),
    form: {
      fields: [
        { name: "toString", title: "Optional number", type: "number" as const, required: false },
        { name: "valueOf", title: "Optional text", type: "string" as const, required: false },
        { name: "hasOwnProperty", title: "Confirm", type: "boolean" as const, required: true },
      ],
    },
  }
  const values = elicitationDefaults(form)
  expect(elicitationContent(form, values)).toEqual({ content: { hasOwnProperty: false } })
  expect(elicitationContent(form, { ...values, toString: "2.5", valueOf: "chosen" })).toEqual({
    content: { hasOwnProperty: false, toString: 2.5, valueOf: "chosen" },
  })
})

test("live hydration fences changed sessions, preserves drafts by request identity and retains state on transient failure", async () => {
  const first = SessionID.make(`ses_${"1".repeat(26)}`)
  const second = SessionID.make(`ses_${"2".repeat(26)}`)
  const forms = [request(first), request(second)]
  const started = Promise.withResolvers<void>()
  const hold = Promise.withResolvers<void>()
  const hydrated = Promise.withResolvers<void>()
  const state = { sessionID: first, failing: false, held: false, requests: [] as McpElicitationRequest[] }
  const server = createServer(async (incoming, response) => {
    const form = forms.find((item) => incoming.url?.includes(item.sessionID))!
    if (form.sessionID === first && !state.held) {
      state.held = true
      started.resolve()
      await hold.promise
    }
    response.writeHead(state.failing ? 503 : 200, { "content-type": "application/json" })
    response.end(JSON.stringify(state.failing ? {} : [form]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP listener")
  const watcher = watchMcpElicitations(
    createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}` }).v2.mcpElicitation,
    () => [state.sessionID],
    (requests) => {
      state.requests = requests
      if (requests[0]?.sessionID === second) hydrated.resolve()
    },
  )
  try {
    await started.promise
    state.sessionID = second
    await watcher.refresh()
    await hydrated.promise
    hold.resolve()
    expect(state.requests.map((item) => item.sessionID)).toEqual([second])
    const identity = state.requests[0]
    await watcher.refresh()
    expect(state.requests[0]).toBe(identity)
    state.failing = true
    await watcher.refresh()
    expect(state.requests[0]).toBe(identity)
  } finally {
    watcher.close()
    hold.resolve()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 10000)

test("hydration includes descendants without client metadata, retains drafts, and clears stale forms after restart", async () => {
  const root = SessionID.make(`ses_${"1".repeat(26)}`)
  const child = SessionID.make(`ses_${"2".repeat(26)}`)
  const form = request(child)
  const hydrated = Promise.withResolvers<void>()
  const state = { failing: false, restarted: false, requests: [] as McpElicitationRequest[] }
  const server = createServer((incoming, response) => {
    expect(incoming.url).toBe(`/api/session/${root}/mcp/elicitation?includeDescendants=true`)
    response.writeHead(state.failing ? 503 : 200, { "content-type": "application/json" })
    response.end(JSON.stringify(state.failing ? {} : state.restarted ? [] : [form]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP listener")
  const watcher = watchMcpElicitations(
    createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}` }).v2.mcpElicitation,
    () => [root],
    (requests) => {
      state.requests = requests
      if (requests.length) hydrated.resolve()
    },
  )
  try {
    await hydrated.promise
    const identity = state.requests[0]
    expect(identity.sessionID).toBe(child)
    await watcher.refresh()
    expect(state.requests[0]).toBe(identity)
    state.failing = true
    await watcher.refresh()
    expect(state.requests[0]).toBe(identity)
    state.failing = false
    state.restarted = true
    await watcher.refresh()
    expect(state.requests).toEqual([])
  } finally {
    watcher.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
