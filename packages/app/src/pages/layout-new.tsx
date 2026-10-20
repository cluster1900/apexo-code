import { createEffect, onMount, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar } from "@/components/titlebar"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const isDevBuild =
    (import.meta.env.DEV || import.meta.env.VITE_APEXO_CHANNEL === "dev") &&
    import.meta.env.VITE_DISABLE_DEBUG_BAR !== "1"
  const [state, setState] = createStore({ debugTools: false })

  createEffect(() => setV2Toast(true))
  onMount(() => {
    if (localStorage.getItem("apexo.timestamps") === "show") document.documentElement.dataset.timestamps = "show"
  })

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        debugTools={
          isDevBuild
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {isDevBuild && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
