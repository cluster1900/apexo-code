export * as MonitorEvents from "./monitor-events"

// Match the public Grok monitor limits; bound partial lines before they reach
// the model, including commands that never print a newline.
export const LINE_LIMIT = 500
export const BATCH_LIMIT = 3_000
export const DEBOUNCE_MS = 200
const CAPACITY = 10
const REFILL_MS = 2_000
const OVERLOAD_MS = 30_000

export function create() {
  const state = {
    tail: "",
    truncated: false,
    tokens: CAPACITY,
    refillAt: undefined as number | undefined,
    suppressedAt: undefined as number | undefined,
    lastSuppressedAt: undefined as number | undefined,
    suppressed: 0,
    lines: 0,
    stopped: false,
  }
  return {
    push(chunk: string, now: number, end = false) {
      const events: string[] = []
      if (state.stopped) return { events, stopped: true, lines: state.lines }
      state.refillAt ??= now
      const refill = Math.floor(Math.max(0, now - state.refillAt) / REFILL_MS)
      state.tokens = Math.min(CAPACITY, state.tokens + refill)
      state.refillAt += refill * REFILL_MS
      const pieces = chunk.split("\n")
      pieces.forEach((piece, index) => {
        if (state.stopped) return
        const chars = Array.from(state.tail + piece)
        state.tail = chars.slice(0, LINE_LIMIT).join("")
        state.truncated ||= chars.length > LINE_LIMIT
        if (index === pieces.length - 1 && !end) return
        const line = state.tail.replace(/\r$/, "") + (state.truncated ? "… [line truncated]" : "")
        state.tail = ""
        state.truncated = false
        if (!line.trim()) return
        state.lines++
        if (state.tokens > 0) {
          state.tokens--
          if (state.lastSuppressedAt !== undefined && now - state.lastSuppressedAt > REFILL_MS * 3)
            state.suppressedAt = undefined
          if (state.suppressed)
            events.push(`[${state.suppressed} monitor events suppressed; filter the command output.]`)
          state.suppressed = 0
          events.push(line)
          return
        }
        state.suppressed++
        state.suppressedAt ??= now
        state.lastSuppressedAt = now
        if (now - state.suppressedAt <= OVERLOAD_MS) return
        state.stopped = true
        events.push(
          `[Monitor stopped: sustained output overload; ${state.suppressed} events suppressed. Restart with a more selective filter.]`,
        )
      })
      return { events, stopped: state.stopped, lines: state.lines }
    },
  }
}
