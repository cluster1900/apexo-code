import { createSignal } from "solid-js"

// Grok Build `/multiline` (`/ml`): when on, Enter inserts a newline and Shift+Enter or Alt+Enter sends. An empty
// composer still sends on Enter so a queued follow-up can be force-sent mid-turn. Persisted per browser profile.
const KEY = "apexo.multiline"
const stored = () => {
  try {
    return globalThis.localStorage?.getItem(KEY) === "on"
  } catch {
    return false
  }
}
const [multiline, set] = createSignal(stored())

export { multiline }

export function setMultiline(value: boolean) {
  set(value)
  try {
    globalThis.localStorage?.setItem(KEY, value ? "on" : "off")
  } catch {}
}

/** What Enter should do. "default" leaves the composer's normal behavior (Enter sends, Shift+Enter newline). */
export function enterAction(input: { multiline: boolean; shift: boolean; alt: boolean; empty: boolean }) {
  if (!input.multiline) return "default" as const
  if (input.shift || input.alt) return "send" as const
  return input.empty ? ("send" as const) : ("newline" as const)
}
