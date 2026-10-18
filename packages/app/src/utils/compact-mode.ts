import { createSignal } from "solid-js"
import { resolveCompactMode } from "@apexo/sdk/v2/grok-commands"

// Grok Build `/compact-mode`: less padding and tighter spacing. Config `ui.compact_mode` is the default; the
// local toggle (per browser profile) overrides it once set. Applied as `data-compact` on the document root.
const KEY = "apexo.compact_mode"
const read = () => {
  const value = globalThis.localStorage?.getItem(KEY)
  return value === "on" ? true : value === "off" ? false : undefined
}
const [local, set] = createSignal<boolean | undefined>(read())
type Config = Parameters<typeof resolveCompactMode>[1]
export const compactMode = (config?: Config) => resolveCompactMode(local(), config)
export function setCompactMode(value: boolean) {
  set(value)
  globalThis.localStorage?.setItem(KEY, value ? "on" : "off")
}
export function applyCompactMode(config?: Config) {
  document.documentElement.dataset.compact = compactMode(config) ? "on" : "off"
}
