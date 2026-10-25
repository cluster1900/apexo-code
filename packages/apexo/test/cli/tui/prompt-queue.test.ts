import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptQueue } from "../../../../tui/src/prompt/queue"
import type { PromptDraft } from "../../../../tui/src/prompt/delivery"

const draft: PromptDraft = {
  sessionID: "ses_queue",
  agentName: "build",
  model: { providerID: "test", modelID: "test" },
  mode: "normal",
  inputText: "queued request",
  nonTextParts: [],
  editorParts: [],
  historyPrompt: { input: "queued request", parts: [] },
}

function fixture() {
  return createRoot((dispose) => {
    const [state, setState] = createStore({ busy: true })
    const delivered: PromptDraft[] = []
    const queue = createPromptQueue({
      busy: () => state.busy,
      deliver: async (item) => {
        delivered.push(item)
      },
      onError: (error) => {
        throw error
      },
    })
    return { queue, delivered, setBusy: (busy: boolean) => setState("busy", busy), [Symbol.dispose]: dispose }
  })
}

test("interrupting an empty queue does not pause later queued work", async () => {
  using f = fixture()
  f.queue.pause(draft.sessionID)
  f.queue.push(draft)
  f.setBusy(false)
  await Promise.resolve()
  expect(f.delivered).toEqual([draft])
  expect(f.queue.list(draft.sessionID)).toEqual([])
  expect(f.queue.paused(draft.sessionID)).toBe(false)
})

test("interrupt preserves pending drafts until edited, then a new queue can drain", async () => {
  using f = fixture()
  f.queue.push(draft)
  f.queue.pause(draft.sessionID)
  f.setBusy(false)
  await Promise.resolve()
  expect(f.delivered).toEqual([])
  expect(f.queue.paused(draft.sessionID)).toBe(true)
  expect(f.queue.pop(draft.sessionID)).toEqual(draft)
  f.queue.push(draft)
  await Promise.resolve()
  expect(f.delivered).toEqual([draft])
  expect(f.queue.list(draft.sessionID)).toEqual([])
})
