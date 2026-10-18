import { resolveVimMode } from "@apexo/sdk/v2/grok-commands"
import { useKV } from "./kv"
import { useSync } from "./sync"

/** /vim-mode state: config `ui.vim_mode` is the default, the persisted local toggle overrides it. */
export function useVimMode() {
  const kv = useKV()
  const sync = useSync()
  const [local, setLocal] = kv.signal<boolean | undefined>("vim_mode", undefined)
  const enabled = () => resolveVimMode(local(), sync.data.config)
  const toggle = () => {
    const next = !enabled()
    setLocal(next as never)
    return next
  }
  return { enabled, toggle }
}
