import { createSignal } from "solid-js"
import { resolveCompactMode } from "@apexo/sdk/v2/grok-commands"
import { useKV } from "./kv"
import { useSync } from "./sync"

// Spacing used by the transcript. Module level so every message component reads the same value.
const [compact, setCompactSignal] = createSignal(false)
/** Vertical gap between transcript blocks: 0 in compact mode, 1 otherwise. */
export const space = () => (compact() ? 0 : 1)
export { compact }

/** /compact-mode state: config `ui.compact_mode` is the default, the persisted local toggle overrides it. */
export function useCompactMode() {
  const kv = useKV()
  const sync = useSync()
  const [local, setLocal] = kv.signal<boolean | undefined>("compact_mode", undefined)
  const enabled = () => resolveCompactMode(local(), sync.data.config)
  const toggle = () => {
    const next = !enabled()
    setLocal(next as never)
    return next
  }
  return { enabled, toggle, sync: () => setCompactSignal(enabled()) }
}
