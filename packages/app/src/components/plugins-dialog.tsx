import { onCleanup } from "solid-js"
import { useDialog } from "@apexo/ui/context/dialog"

export function usePluginsDialog() {
  const dialog = useDialog()
  const lifecycle = { alive: true, request: 0 }
  onCleanup(() => {
    lifecycle.alive = false
  })
  return () => {
    const request = ++lifecycle.request
    void import("./plugins").then((module) => {
      if (lifecycle.alive && lifecycle.request === request) dialog.show(() => <module.PluginsDialog />)
    })
  }
}
