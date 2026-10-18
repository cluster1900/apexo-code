import { createSignal } from "solid-js"

// `/context-window`: per-session choice for the life of this window, like Grok Build's session-scoped setting.
const [choices, setChoices] = createSignal<Record<string, number>>({})
export const contextWindowChoice = (sessionID: string | undefined) => (sessionID ? choices()[sessionID] : undefined)
export function setContextWindowChoice(sessionID: string, size: number) {
  setChoices((current) => ({ ...current, [sessionID]: size }))
}
