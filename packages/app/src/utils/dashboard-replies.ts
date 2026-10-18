import { createSignal } from "solid-js"

// Agent dashboard peek replies to busy agents queue like the agent view prompt does in the TUI (the legacy prompt API
// has no server-side queue delivery). Process-wide so a reply keeps waiting after the dashboard closes; the pump runs
// wherever Grok commands are mounted and is safe to run from several owners at once.
export type DashboardReply = {
  sessionID: string
  text: string
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
}

const [queue, setQueue] = createSignal<DashboardReply[]>([])
const sending = new Set<string>()

export const dashboardReplies = queue

export function enqueueDashboardReply(reply: DashboardReply) {
  setQueue((items) => [...items, reply])
}

/** Delivers the oldest queued reply of every session that is idle again. Call from a reactive effect. */
export function pumpDashboardReplies(input: {
  busy: (sessionID: string) => boolean
  deliver: (reply: DashboardReply) => Promise<unknown>
  onError: (error: unknown) => void
}) {
  const heads = queue().filter(
    (item, index, all) => all.findIndex((other) => other.sessionID === item.sessionID) === index,
  )
  heads
    .filter((item) => !sending.has(item.sessionID) && !input.busy(item.sessionID))
    .forEach((item) => {
      sending.add(item.sessionID)
      void input
        .deliver(item)
        .catch(input.onError)
        .finally(() => {
          sending.delete(item.sessionID)
          setQueue((items) => items.filter((other) => other !== item))
        })
    })
}

const PINS = "apexo.dashboard.pinned"
const readPins = (): string[] => {
  const value = globalThis.localStorage?.getItem(PINS)
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
}
const [pins, setPins] = createSignal(readPins())
/** Dashboard pins (Ctrl+T), persisted per browser profile like the TUI's pinned sessions. */
export const dashboardPins = pins
export function toggleDashboardPin(sessionID: string) {
  const next = pins().includes(sessionID) ? pins().filter((id) => id !== sessionID) : [...pins(), sessionID]
  setPins(next)
  globalThis.localStorage?.setItem(PINS, JSON.stringify(next))
}
