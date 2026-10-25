import { expect, test } from "bun:test"
import type { Message, Part } from "@apexo/sdk/v2/client"
import { applyOptimisticAdd, mergeOptimisticPage } from "./sync"

const message = (created: number): Message => ({
  id: "msg_same",
  sessionID: "ses_test",
  role: "user",
  time: { created },
  agent: "build",
  model: { providerID: "test", modelID: "test" },
})
const part: Part = { id: "prt_same", sessionID: "ses_test", messageID: "msg_same", type: "text", text: "hello" }

test("server confirmation replaces optimistic identity even when admission changes its timestamp", () => {
  const confirmed = message(200)
  const result = mergeOptimisticPage(
    { session: [confirmed], part: [{ id: confirmed.id, part: [part] }], complete: true },
    [{ message: message(100), parts: [part] }],
  )
  expect(result.session).toEqual([confirmed])
  expect(result.confirmed).toEqual([confirmed.id])
})

test("an event arriving before optimistic insertion is kept exactly once", () => {
  const confirmed = message(200)
  const store = { message: { ses_test: [confirmed] }, part: { msg_same: [part] } }
  applyOptimisticAdd(store, { sessionID: "ses_test", message: message(100), parts: [part] })
  expect(store.message.ses_test).toEqual([confirmed])
  expect(store.part.msg_same).toEqual([part])
})

test("message events reconcile changed timestamps and preserve chronological order", async () => {
  const { createStore } = await import("solid-js/store")
  const { applyDirectoryEvent } = await import("./global-sync/event-reducer")
  type State = Parameters<typeof applyDirectoryEvent>[0]["store"]
  const between = { ...message(150), id: "msg_between" }
  const [store, setStore] = createStore<State>({
    status: "complete",
    agent: [],
    command: [],
    reference: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider: { all: new Map(), connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "/project", directory: "/project", home: "" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_working: () => false,
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    mcp_resource: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: { ses_test: [message(100), between] },
    session_message: {},
    part: {},
    part_text_accum_delta: {},
  })
  const event = { type: "message.updated", properties: { info: message(200) } }
  const input = { store, setStore, event, directory: "/project", push: () => {}, loadLsp: () => {} }
  applyDirectoryEvent(input)
  applyDirectoryEvent(input)
  expect(store.message.ses_test).toEqual([between, message(200)])
})

test("active server session reconciles optimistic timestamp changes without duplicate identities", async () => {
  const { createApexoClient } = await import("@apexo/sdk/v2/client")
  const { createServerSession } = await import("./server-session")
  const session = createServerSession(createApexoClient({ baseUrl: "http://unused.invalid" }))
  session.optimistic.add({ sessionID: "ses_test", message: message(100), parts: [part] })
  session.apply({ type: "message.updated", properties: { info: message(200) } })
  session.apply({ type: "message.updated", properties: { info: message(200) } })
  expect(session.data.message.ses_test).toEqual([message(200)])
  expect(session.data.part.msg_same).toEqual([part])
})
