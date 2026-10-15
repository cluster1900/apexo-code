import type { ApexoClient, SessionScheduleRestoration } from "@apexo/sdk/v2/client"
import type { ServerProtocol } from "./server-protocol"
import type { useLanguage } from "@/context/language"

export type RestorationTarget = {
  client: ApexoClient
  protocol: Promise<ServerProtocol>
  sessionID: string
}

export class SessionRestorationError extends Error {
  constructor() {
    super("Session restoration is unavailable")
  }
}

// Capture the caller's server client and Session once. Never consult a later selected tab.
export async function restoreSession(target: RestorationTarget, signal = AbortSignal.timeout(15_000)) {
  const client = target.client
  const sessionID = target.sessionID
  const protocol = await target.protocol.catch(() => {
    throw new SessionRestorationError()
  })
  if (protocol !== "v2") return
  if (signal.aborted) return
  const response = await client.v2.session.restore({ sessionID }, { signal, throwOnError: false }).catch(() => {
    throw new SessionRestorationError()
  })
  if (response.error || !response.data) throw new SessionRestorationError()
  return response.data
}

export function restorationMessage(result: SessionScheduleRestoration | undefined) {
  if (!result) return
  for (const outcome of result.schedules) {
    switch (outcome.reason) {
      case "permission_required":
        return "session.restore.permissionRequired" as const
      case "unfinished_owner":
        return "session.restore.unfinishedOwner" as const
      case "headless_input":
        return "session.restore.headless" as const
      case "changed":
        return "session.restore.changed" as const
      case "goal_active":
        return "tasks.scheduleReason.goal_active" as const
      case "plan_pending":
        return "tasks.scheduleReason.plan_pending" as const
      case "denied":
        return "tasks.scheduleReason.denied" as const
      case "unavailable":
        return "tasks.scheduleReason.unavailable" as const
    }
  }
}

export async function announceSessionRestoration(target: RestorationTarget, t: ReturnType<typeof useLanguage>["t"]) {
  const { showToast } = await import("./toast")
  await restoreSession(target)
    .then((result) => {
      const key = restorationMessage(result)
      if (key) showToast({ title: t("session.restore.action"), description: t(key) })
    })
    .catch(() => showToast({ title: t("session.restore.action"), description: t("session.restore.failed") }))
}
