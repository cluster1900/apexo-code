import { createSignal } from "solid-js"
import { resolveVimMode, vimScrollAction } from "@apexo/sdk/v2/grok-commands"

// Grok Build `/vim-mode`: vim-style scrollback keys. Persisted per browser profile like the TUI kv `vim_mode`.
const KEY = "apexo.vim_mode"
export const VIM_SCROLL_EVENT = "apexo:vim-scroll"
const read = () => {
  const value = globalThis.localStorage?.getItem(KEY)
  return value === "on" ? true : value === "off" ? false : undefined
}
const [local, set] = createSignal<boolean | undefined>(read())
type Config = Parameters<typeof resolveVimMode>[1]
/** Config `ui.vim_mode` is the default; the local /vim-mode toggle overrides it once set. */
export const vimMode = (config?: Config) => resolveVimMode(local(), config)
export function setVimMode(value: boolean) {
  set(value)
  globalThis.localStorage?.setItem(KEY, value ? "on" : "off")
}

const editable = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement &&
  (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))

function scroller() {
  let element = document.querySelector("[data-message-id]")?.parentElement ?? null
  while (element) {
    const style = getComputedStyle(element)
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element
    element = element.parentElement
  }
  return undefined
}

function jumpMessage(container: HTMLElement, direction: 1 | -1) {
  const top = container.getBoundingClientRect().top
  const offsets = [...container.querySelectorAll("[data-message-id]")].map(
    (item) => item.getBoundingClientRect().top - top,
  )
  const target = direction > 0 ? offsets.find((y) => y > 10) : offsets.reverse().find((y) => y < -10)
  container.scrollBy({ top: target ?? direction * container.clientHeight })
}

export function promptEditor() {
  return (document.querySelector('[data-component="prompt-input"] [contenteditable="true"]') ??
    document.querySelector('[contenteditable="true"]')) as HTMLElement | null
}

/**
 * Keydown handler for the session page. Esc on an empty prompt moves focus to the scrollback; outside an editable
 * element the vim keys drive the timeline, and any other printable key returns to the prompt and types it.
 */
export function vimKeydown(
  event: KeyboardEvent,
  copy: { message: () => void; transcript: () => void },
  config?: Config,
) {
  if (!vimMode(config) || event.defaultPrevented || event.metaKey || event.isComposing) return
  if (document.querySelector('[role="dialog"]')) return
  const active = document.activeElement
  if (editable(active)) {
    if (event.key === "Escape" && active.isContentEditable && !active.textContent?.trim()) {
      active.blur()
      event.preventDefault()
    }
    return
  }
  const name = event.key.toLowerCase().replace(/^arrow/, "")
  const result = vimScrollAction({
    name,
    char: event.key.length === 1 ? event.key : undefined,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
  })
  if (!result) return
  event.preventDefault()
  const container = scroller()
  const line = 40
  switch (result.action) {
    case "prompt": {
      const editor = promptEditor()
      editor?.focus()
      if (result.type) document.execCommand("insertText", false, result.type)
      return
    }
    case "copy.message":
      return copy.message()
    case "copy.transcript":
      return copy.transcript()
  }
  if (!container) return
  // Tell the timeline this is a user scroll so it stops following the bottom (same as wheel/keys).
  window.dispatchEvent(new CustomEvent(VIM_SCROLL_EVENT))
  const height = container.clientHeight
  if (result.action === "line.down") container.scrollBy({ top: line })
  if (result.action === "line.up") container.scrollBy({ top: -line })
  if (result.action === "half.down") container.scrollBy({ top: height / 2 })
  if (result.action === "half.up") container.scrollBy({ top: -height / 2 })
  if (result.action === "page.down") container.scrollBy({ top: height * 0.9 })
  if (result.action === "page.up") container.scrollBy({ top: -height * 0.9 })
  if (result.action === "first") container.scrollTop = 0
  if (result.action === "last") container.scrollTop = container.scrollHeight
  if (result.action === "message.next") jumpMessage(container, 1)
  if (result.action === "message.previous") jumpMessage(container, -1)
}
