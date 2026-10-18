import { createStore } from "solid-js/store"
import { resolvePermissionMode } from "@apexo/sdk/v2/grok-commands"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

// "auto" is always-approve (the historical opencode name for --auto); "review" is Grok Build's Auto-review mode
// (`/auto`), where the shared classifier approves routine calls and anything else still prompts.
export type PermissionMode = "auto" | "review" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode; touched: boolean }>({
      mode: args.auto ? "auto" : "normal",
      touched: !!args.auto,
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore({ mode, touched: true })
      },
      toggle() {
        setStore({ mode: store.mode === "auto" ? "normal" : "auto", touched: true })
      },
      /** `/auto`: switches into Auto-review (replacing always-approve) or back to ask. */
      toggleReview() {
        setStore({ mode: store.mode === "review" ? "normal" : "review", touched: true })
      },
      /** Config `ui.permission_mode` is the launch default; flags and toggles win. */
      applyConfig(value: string | undefined) {
        if (store.touched) return
        const mode = resolvePermissionMode({ config: value })
        setStore("mode", mode === "always-approve" ? "auto" : mode === "auto" ? "review" : "normal")
      },
    }
  },
})
