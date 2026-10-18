// Runtime renderer switching (Grok Build `/minimal` and `/fullscreen` / `/full`). The terminal entry point keeps one
// backend and loops over renderers; a renderer requests a switch here and then closes itself.
export type ModeSwitchRequest = {
  mode: "minimal" | "fullscreen"
  sessionID?: string
  draft?: string
  agent?: string
  model?: string
}

const state: { available: boolean; pending?: ModeSwitchRequest; draft?: string } = { available: false }

export const ModeSwitch = {
  /** True only while the local terminal entry point is looping over renderers (not attach, not headless run). */
  get available() {
    return state.available
  },
  setAvailable(value: boolean) {
    state.available = value
  },
  request(value: ModeSwitchRequest) {
    state.pending = value
  },
  /** Unsent draft carried into the next renderer's prompt; read once by the renderer that mounts next. */
  seedDraft(value: string | undefined) {
    state.draft = value?.length ? value : undefined
  },
  takeDraft() {
    const value = state.draft
    state.draft = undefined
    return value
  },
  take() {
    const value = state.pending
    state.pending = undefined
    return value
  },
}

export function modeCommand(text: string): ModeSwitchRequest["mode"] | undefined {
  const value = text.trim().toLowerCase()
  if (value === "/minimal") return "minimal"
  if (value === "/fullscreen" || value === "/full") return "fullscreen"
  return undefined
}
