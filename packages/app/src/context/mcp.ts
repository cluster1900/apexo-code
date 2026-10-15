import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import type { McpAction } from "./global-sync/mcp"
import { showToast } from "@/utils/toast"

export function useMcpToggle() {
  const sync = useSync()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: sync().mcp.toggle,
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}

export function useMcpManager() {
  const sync = useSync()
  const language = useLanguage()
  const refresh = useMutation(() => ({
    mutationFn: () => sync().mcp.refresh(),
  }))
  const action = useMutation(() => ({
    mutationFn: (input: { name: string; action: McpAction }) => sync().mcp.manage(input.name, input.action),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : undefined,
      }),
  }))
  return {
    refresh,
    action,
    authStart: (name: string) => sync().mcp.authStart(name),
    authCancel: (name: string, flowID: string) => sync().mcp.authCancel(name, flowID),
  }
}
