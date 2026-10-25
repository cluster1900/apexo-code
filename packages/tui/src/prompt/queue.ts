import { batch, createEffect } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import type { PromptDraft } from "./delivery"

export function createPromptQueue(input: {
  busy: (sessionID: string) => boolean
  deliver: (draft: PromptDraft) => Promise<unknown>
  onError: (error: unknown) => void
}) {
  const [store, setStore] = createStore({
    items: {} as Record<string, PromptDraft[]>,
    sending: {} as Record<string, boolean>,
    paused: {} as Record<string, boolean>,
  })

  createEffect(() => {
    Object.entries(store.items).forEach(([sessionID, items]) => {
      const next = items[0]
      if (!next || store.sending[sessionID] || store.paused[sessionID] || input.busy(sessionID)) return
      setStore("sending", sessionID, true)
      // Keep the draft until the request succeeds, including command failures.
      void input.deliver(next).then(
        () => {
          batch(() => {
            setStore("items", sessionID, (items) => items.slice(1))
            if (!store.items[sessionID]?.length) setStore("paused", sessionID, false)
            setStore("sending", sessionID, false)
          })
        },
        (error: unknown) => {
          batch(() => {
            setStore("paused", sessionID, true)
            setStore("sending", sessionID, false)
          })
          input.onError(error)
        },
      )
    })
  })

  return {
    list: (sessionID: string) => store.items[sessionID] ?? [],
    sending: (sessionID: string) => store.sending[sessionID] ?? false,
    paused: (sessionID: string) => store.paused[sessionID] ?? false,
    pause(sessionID: string) {
      if (store.items[sessionID]?.length) setStore("paused", sessionID, true)
    },
    push(draft: PromptDraft) {
      setStore("items", draft.sessionID, (items = []) => [...items, structuredClone(unwrap(draft))])
    },
    pop(sessionID: string) {
      if (store.sending[sessionID] && store.items[sessionID]?.length === 1) return
      const last = store.items[sessionID]?.at(-1)
      if (!last) return
      setStore("items", sessionID, (items) => items.slice(0, -1))
      // Editing a failed or interrupted draft must not restart the remaining queue.
      if (!store.items[sessionID]?.length) setStore("paused", sessionID, false)
      return last
    },
  }
}
