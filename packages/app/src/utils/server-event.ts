import type { ApexoEvent } from "@apexo/client/promise"
import type { Event } from "@apexo/sdk/v2/client"

export type ServerEvent = Event & { current?: ApexoEvent }

export function adaptServerEvent(event: ApexoEvent): ServerEvent {
  if (event.type === "permission.v2.asked") {
    return {
      id: event.id,
      type: "permission.asked",
      properties: {
        id: event.data.id,
        sessionID: event.data.sessionID,
        permission: event.data.action,
        patterns: event.data.resources,
        always: event.data.save ?? [],
        metadata: {
          ...event.data.metadata,
          nativePermission: true,
          ...("review" in event.data && event.data.review ? { nativeReview: event.data.review } : {}),
        },
        tool:
          event.data.source?.type === "tool"
            ? { messageID: event.data.source.messageID, callID: event.data.source.callID }
            : undefined,
      },
      current: event,
    } as ServerEvent
  }
  if (event.type === "permission.v2.replied")
    return { id: event.id, type: "permission.replied", properties: event.data, current: event } as ServerEvent
  if (event.type === "question.v2.asked")
    return { id: event.id, type: "question.asked", properties: event.data, current: event } as ServerEvent
  if (event.type === "question.v2.replied")
    return { id: event.id, type: "question.replied", properties: event.data, current: event } as ServerEvent
  if (event.type === "question.v2.rejected")
    return { id: event.id, type: "question.rejected", properties: event.data, current: event } as ServerEvent
  const data =
    "data" in event && event.data && typeof event.data === "object"
      ? (event.data as Record<string, unknown>)
      : undefined
  const created =
    "created" in event && typeof event.created === "number"
      ? event.created
      : typeof data?.timestamp === "number"
        ? data.timestamp
        : Date.now()
  const current = (
    "created" in event && typeof event.created === "number" ? event : { ...event, created }
  ) as ApexoEvent
  return { id: event.id, type: event.type, properties: event.data, current } as ServerEvent
}

export function adaptLegacySyncEvent(payload: unknown): ServerEvent | undefined {
  if (!payload || typeof payload !== "object") return
  const value = payload as Record<string, unknown>
  if (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    ((value.type.startsWith("session.next.") && value.type.endsWith(".delta")) ||
      value.type.startsWith("permission.v2.") ||
      value.type.startsWith("permission.review.") ||
      value.type.startsWith("question.v2.")) &&
    value.properties &&
    typeof value.properties === "object"
  ) {
    const data = value.properties as Record<string, unknown>
    const created = typeof data.timestamp === "number" ? data.timestamp : Date.now()
    const current = {
      id: value.id,
      type: value.type,
      created,
      data: value.properties,
    } as unknown as ApexoEvent
    return adaptServerEvent(current)
  }
  if (value.type !== "sync" || !value.syncEvent || typeof value.syncEvent !== "object") return
  const syncEvent = value.syncEvent as Record<string, unknown>
  if (
    typeof syncEvent.id !== "string" ||
    typeof syncEvent.type !== "string" ||
    typeof syncEvent.aggregateID !== "string" ||
    typeof syncEvent.seq !== "number" ||
    typeof syncEvent.data !== "object" ||
    syncEvent.data === null
  )
    return
  const version = Number(syncEvent.type.split(".").at(-1))
  if (!Number.isInteger(version)) return
  const type = syncEvent.type.replace(/\.\d+$/, "")
  const data = syncEvent.data as Record<string, unknown>
  const created = typeof data.timestamp === "number" ? data.timestamp : Date.now()
  const current = {
    id: syncEvent.id,
    type,
    created,
    durable: { aggregateID: syncEvent.aggregateID, seq: syncEvent.seq, version },
    data: syncEvent.data,
  } as ApexoEvent
  return adaptServerEvent(current)
}
