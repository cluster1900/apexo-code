import { createSignal } from "solid-js"

// `/context-window`: per-session choice, lasting for the life of the TUI session like Grok Build.
const [choices, setChoices] = createSignal<Record<string, number>>({})
export const contextWindowChoice = (sessionID: string | undefined) => (sessionID ? choices()[sessionID] : undefined)
export function setContextWindowChoice(sessionID: string, size: number) {
  setChoices((current) => ({ ...current, [sessionID]: size }))
}
