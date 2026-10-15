import type { ApexoClient, TaskMessageInput, TaskMessageReceipt } from "./client.js"

export type TaskMessageIssue = "invalid" | "forbidden" | "missing" | "conflict" | "uncertain"
export type TaskMessageDraft = {
  text: string
  delivery: NonNullable<TaskMessageInput["delivery"]>
  input?: TaskMessageInput
  receipt?: TaskMessageReceipt
  issue?: TaskMessageIssue
  pending: boolean
}

const drafts = new WeakMap<ApexoClient, Map<string, ReturnType<typeof createTaskMessageDraft>>>()

// The client carries the Location/connection identity; the parent and child bind the draft to its owner.
export function taskMessageDraft(client: ApexoClient, sessionID: string, taskID: string, startedAt: number) {
  const cache = drafts.get(client) ?? new Map<string, ReturnType<typeof createTaskMessageDraft>>()
  drafts.set(client, cache)
  const prefix = JSON.stringify([sessionID, taskID])
  const key = `${prefix}:${startedAt}`
  // A submitted input may have started this launch. Carry only its exact receipt lookup,
  // never authority to POST again until current ownership verifies that receipt.
  cache.forEach((value, old) => {
    if (!old.startsWith(`${prefix}:`) || old === key) return
    if (!cache.has(key) && value.state().input) {
      value.reconcileLaunch()
      cache.set(key, value)
    }
    cache.delete(old)
  })
  if (!cache.has(key) && cache.size >= 128) {
    cache.forEach((value, old) => {
      if (cache.size < 128) return
      const current = value.state()
      if (!current.pending && (!current.input || (current.receipt && current.receipt.status !== "admitted")))
        cache.delete(old)
    })
    if (cache.size >= 128) return
  }
  const draft = cache.get(key) ?? createTaskMessageDraft(client, sessionID, taskID)
  cache.set(key, draft)
  return draft
}

function createTaskMessageDraft(client: ApexoClient, sessionID: string, taskID: string) {
  let generation = 0
  let reconcileOnly = false
  let state: TaskMessageDraft = { text: "", delivery: "steer", pending: false }
  const listeners = new Set<(state: TaskMessageDraft) => void>()
  const update = (change: Partial<TaskMessageDraft>) => {
    state = { ...state, ...change }
    listeners.forEach((listener) => listener(state))
  }
  const issue = (status?: number): TaskMessageIssue =>
    status === 400
      ? "invalid"
      : status === 401 || status === 403
        ? "forbidden"
        : status === 404
          ? "missing"
          : status === 409
            ? "conflict"
            : "uncertain"
  return {
    state: () => state,
    reconcileLaunch() {
      generation++
      reconcileOnly = true
      update({ receipt: undefined, issue: "uncertain" })
    },
    subscribe(listener: (state: TaskMessageDraft) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    edit(text: string, delivery = state.delivery) {
      if (!state.input && !state.pending) update({ text, delivery, issue: undefined })
    },
    next() {
      if (reconcileOnly || state.pending || !state.receipt) return
      update({ text: "", delivery: "steer", input: undefined, receipt: undefined, issue: undefined })
    },
    async send(signal: AbortSignal) {
      if (reconcileOnly || signal.aborted || state.pending || state.receipt) return
      const admittedGeneration = generation
      if (!state.text.trim() || new TextEncoder().encode(state.text).byteLength > 32768) {
        update({ issue: "invalid" })
        return
      }
      const input = state.input ?? {
        inputID: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        text: state.text,
        delivery: state.delivery,
      }
      update({ input, pending: true, issue: undefined })
      await client.v2.task.message
        .send({ sessionID, taskID, taskMessageInput: input }, { signal, throwOnError: false })
        .then((result) => {
          if (admittedGeneration !== generation) return
          if (result.data && result.response?.ok) {
            update({ receipt: result.data, issue: undefined })
            return
          }
          const code = issue(result.response?.status)
          // Only a definitive validation/permission rejection permits editing. Network uncertainty retains the exact input.
          update({ issue: code, ...(code === "invalid" || code === "forbidden" ? { input: undefined } : {}) })
        })
        .catch(() => update({ issue: "uncertain" }))
        .finally(() => update({ pending: false }))
    },
    async refresh(signal: AbortSignal) {
      const input = state.input
      const refreshedGeneration = generation
      if (
        signal.aborted ||
        !input ||
        state.pending ||
        (!reconcileOnly && state.receipt && state.receipt.status !== "admitted")
      )
        return
      await client.v2.task.message
        .get({ sessionID, taskID, inputID: input.inputID }, { signal, throwOnError: false })
        .then((result) => {
          if (signal.aborted || state.input !== input || refreshedGeneration !== generation) return
          if (result.data && result.response?.ok) {
            reconcileOnly = false
            update({ receipt: result.data, issue: undefined })
          }
          // A missing receipt after an uncertain send is not evidence that admission cannot still complete.
          else if (result.response?.status !== 404) update({ issue: issue(result.response?.status) })
        })
        .catch(() => {
          if (!signal.aborted && state.input === input && refreshedGeneration === generation)
            update({ issue: "uncertain" })
        })
    },
  }
}
