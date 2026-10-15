import { createApexoClient } from "@apexo/sdk/v2/client"
import type { GlobalEvent } from "@apexo/sdk/v2"
import { sessionTransport } from "../transport/session"
import { restorationNotice } from "../transport/native-session"
import { Flag } from "@apexo/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    local?: boolean
    sessionProtocol?: "auto" | "native" | "compatibility"
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createApexoClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()
    const selectTransport = sessionTransport(sdk, props.directory, props.sessionProtocol, abort.signal)
    const transport = () => selectTransport(abort.signal)
    const nativeHandlers = new Set<(event: unknown) => void>()
    const nativeEvent = {
      on(handler: (event: unknown) => void) {
        nativeHandlers.add(handler)
        return () => {
          nativeHandlers.delete(handler)
        }
      },
    }

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          const selected = await transport()
          if (selected.kind === "native") {
            const events = await selected.subscribe(ctrl.signal)
            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              batch(() => {
                for (const handler of nativeHandlers) handler(event)
              })
            }
            if (abort.signal.aborted || ctrl.signal.aborted) break
            await new Promise((resolve) => setTimeout(resolve, retryDelay))
            continue
          }
          const events = await sdk.global.event({
            signal: ctrl.signal,
            sseMaxRetryAttempts: 0,
          })

          if (Flag.APEXO_EXPERIMENTAL_WORKSPACES) {
            // Start syncing workspaces, it's important to do this after
            // we've started listening to events
            await sdk.sync.start().catch(() => {})
          }

          for await (const event of events.stream) {
            if (ctrl.signal.aborted) break
            handleEvent(event)
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(handleEvent)
        onCleanup(unsub)

        if (Flag.APEXO_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          await sdk.sync.start().catch(() => {})
        }
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
      nativeHandlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      transport,
      nativeEvent,
      async sessionInfo(sessionID: string) {
        const selected = await transport()
        if (selected.kind === "compatibility")
          return (await sdk.session.get({ sessionID }, { throwOnError: true })).data
        const { terminalSession } = await import("../transport/native-catalog")
        return terminalSession(await selected.get(sessionID))
      },
      async restoreSession(sessionID: string) {
        const selected = await transport()
        if (selected.kind !== "native") return
        return restorationNotice(await selected.restore(sessionID))
      },
      async forkSession(sessionID: string) {
        const selected = await transport()
        if (selected.kind === "native") throw new Error("Forking native Sessions is not available in the terminal")
        return sdk.session.fork({ sessionID }, { throwOnError: true })
      },
      async interrupt(sessionID: string) {
        const selected = await transport()
        return selected.kind === "native"
          ? selected.interrupt(sessionID)
          : sdk.session.abort({ sessionID }, { throwOnError: true })
      },
      async replyQuestion(input: { sessionID: string; requestID: string; answers: string[][]; directory?: string }) {
        const selected = await transport()
        return selected.kind === "native"
          ? selected.replyQuestion({
              sessionID: input.sessionID,
              requestID: input.requestID,
              questionV2Reply: { answers: input.answers },
            })
          : sdk.question.reply(input, { throwOnError: true })
      },
      async rejectQuestion(input: { sessionID: string; requestID: string; directory?: string }) {
        const selected = await transport()
        return selected.kind === "native"
          ? selected.rejectQuestion(input)
          : sdk.question.reject(input, { throwOnError: true })
      },
      async replyPermission(input: {
        sessionID: string
        requestID: string
        reply: "once" | "always" | "reject"
        message?: string
        directory?: string
        workspace?: string
      }) {
        const selected = await transport()
        return selected.kind === "native"
          ? selected.replyPermission(input)
          : sdk.permission.reply(input, { throwOnError: true })
      },
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
      local: props.local ?? false,
    }
  },
})
