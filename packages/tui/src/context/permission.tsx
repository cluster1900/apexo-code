import { PermissionReview } from "@apexo/schema/permission-review"
import { Option, Schema } from "effect"
import { createEffect, onCleanup } from "solid-js"
import { useSDK } from "./sdk"
import { useRoute } from "./route"
import { createStore, reconcile } from "solid-js/store"
import { resolvePermissionMode } from "@apexo/sdk/v2/grok-commands"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

// "auto" is always-approve (the historical opencode name for --auto); "review" is Grok Build's Auto-review mode
// (`/auto`). Native Sessions read backend mode; compatibility Sessions retain their classifier.
export type PermissionMode = "auto" | "review" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const sdk = useSDK()
    const route = useRoute()
    const connection = { generation: 0 }
    const [store, setStore] = createStore<{
      mode: PermissionMode
      touched: boolean
      native: boolean
      states: Record<string, { mode: "manual" | "review"; revision: number }>
    }>({
      mode: args.auto ? "auto" : "normal",
      touched: !!args.auto,
      native: false,
      states: {},
    })
    const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
    const update = (id: string, value: { mode: "manual" | "review"; revision: number }) => {
      if ((store.states[id]?.revision ?? -1) <= value.revision) setStore("states", id, value)
    }
    const hydrate = async () => {
      const generation = connection.generation
      const id = sessionID()
      const selected = await sdk.transport()
      if (generation !== connection.generation) return
      setStore("native", selected.kind === "native")
      if (selected.kind !== "native" || !id) return
      const state = await selected.permissionReview(id)
      if (generation === connection.generation) update(id, state)
    }
    createEffect(() => {
      sessionID()
      void hydrate().catch(() => undefined)
    })
    const decode = Schema.decodeUnknownOption(PermissionReview.Event.ModeChanged)
    onCleanup(
      sdk.nativeEvent.on((event) => {
        const parsed = decode(event)
        if (Option.isSome(parsed)) update(parsed.value.data.sessionID, parsed.value.data)
        if (event && typeof event === "object" && "type" in event && event.type === "server.connected") {
          connection.generation++
          setStore("states", reconcile({}))
          void hydrate().catch(() => undefined)
        }
      }),
    )
    const mode = (): PermissionMode =>
      store.native && store.mode !== "auto"
        ? store.states[sessionID() ?? ""]?.mode === "review"
          ? "review"
          : "normal"
        : store.mode
    const set = async (value: PermissionMode) => {
      const generation = connection.generation
      const selected = await sdk.transport()
      if (selected.kind === "native") {
        const id = sessionID()
        if (!id) throw new Error("Open a session first")
        const state = await selected.setPermissionReview(id, value === "review" ? "review" : "manual")
        if (generation !== connection.generation) return
        update(id, state)
        setStore({ mode: value === "auto" ? "auto" : "normal", native: true, touched: true })
        return
      }
      setStore({ mode: value, touched: true })
    }
    return {
      get mode() {
        return mode()
      },
      set,
      toggle: () => set(mode() === "auto" ? "normal" : "auto"),
      toggleReview: () => set(mode() === "review" ? "normal" : "review"),
      /** Config `ui.permission_mode` is the launch default; flags and toggles win. */
      applyConfig(value: string | undefined) {
        if (store.touched) return
        void sdk.transport().then((selected) => {
          if (selected.kind === "native" || store.touched) return
          const mode = resolvePermissionMode({ config: value })
          setStore("mode", mode === "always-approve" ? "auto" : mode === "auto" ? "review" : "normal")
        })
      },
    }
  },
})
