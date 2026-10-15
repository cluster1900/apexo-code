export * as SessionProcessMonitor from "./process-monitor"

import type { AppProcess } from "../process"

export const DEBOUNCE_MS = 200
export const LINE_LIMIT = 500
export const BATCH_LIMIT = 3_000
export const CAPACITY = 10
export const REFILL_MS = 2_000
export const OVERLOAD_MS = 30_000

/** Monitor notifications charge a token per batch, independently of the legacy line limiter. */
export function make() {
  const channels = () => ({
    stdout: { decoder: new TextDecoder(), tail: "", length: 0, truncated: false },
    stderr: { decoder: new TextDecoder(), tail: "", length: 0, truncated: false },
    combined: { decoder: new TextDecoder(), tail: "", length: 0, truncated: false },
  })
  const state = {
    channels: channels(),
    text: "",
    length: 0,
    truncated: false,
    tokens: CAPACITY,
    refillAt: undefined as number | undefined,
    suppressionStart: undefined as number | undefined,
    lastSuppressed: undefined as number | undefined,
    pendingSuppressed: 0,
    accepted: 0,
    suppressed: 0,
    overloaded: false,
    finished: false,
  }
  const append = (text: string) => {
    const line = text.trim()
    if (!line) return
    for (const char of (state.text ? "\n" : "") + line) {
      if (state.length >= BATCH_LIMIT) {
        state.truncated = true
        break
      }
      state.text += char
      state.length++
    }
  }
  const consume = (channel: keyof typeof state.channels, text: string) => {
    const current = state.channels[channel]
    for (const char of text) {
      if (char === "\n") {
        append(current.tail + (current.truncated ? "… [line truncated]" : ""))
        current.tail = ""
        current.length = 0
        current.truncated = false
        continue
      }
      if (current.length >= LINE_LIMIT) {
        current.truncated = true
        continue
      }
      current.tail += char
      current.length++
    }
  }
  return {
    push(chunk: AppProcess.OutputChunk) {
      if (state.finished || state.overloaded) return
      consume(chunk.channel, state.channels[chunk.channel].decoder.decode(chunk.data, { stream: true }))
    },
    clear() {
      state.channels = channels()
      state.text = ""
      state.length = 0
      state.truncated = false
    },
    finish() {
      if (state.finished) return
      state.finished = true
      for (const channel of ["stdout", "stderr", "combined"] as const) {
        consume(channel, state.channels[channel].decoder.decode())
        const current = state.channels[channel]
        append(current.tail + (current.truncated ? "… [line truncated]" : ""))
        current.tail = ""
      }
    },
    flush(now: number) {
      if (!state.text || state.overloaded) return undefined
      const text = state.text + (state.truncated ? "\n[batch truncated]" : "")
      state.text = ""
      state.length = 0
      state.truncated = false
      state.refillAt ??= now
      const refill = Math.floor(Math.max(0, now - state.refillAt) / REFILL_MS)
      state.tokens = Math.min(CAPACITY, state.tokens + refill)
      state.refillAt += refill * REFILL_MS
      if (state.tokens > 0) {
        state.tokens--
        state.accepted++
        const warning = state.pendingSuppressed
          ? `[${state.pendingSuppressed} monitor batches suppressed; filter the command output.]\n`
          : ""
        state.pendingSuppressed = 0
        if (state.lastSuppressed !== undefined && now - state.lastSuppressed > REFILL_MS * 3)
          state.suppressionStart = undefined
        return warning + text
      }
      state.suppressed++
      state.pendingSuppressed++
      state.suppressionStart ??= now
      state.lastSuppressed = now
      if (now - state.suppressionStart <= OVERLOAD_MS) return undefined
      state.overloaded = true
      return `[Monitor stopped: sustained output overload; ${state.pendingSuppressed} batches suppressed. Restart with a more selective filter.]`
    },
    read: () => ({ accepted: state.accepted, suppressed: state.suppressed, overloaded: state.overloaded }),
  }
}
