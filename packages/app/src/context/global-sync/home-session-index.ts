import type { Event, Session, SessionV2Info, V2SessionListResponse } from "@apexo/sdk/v2/client"
import type { QueryClient } from "@tanstack/solid-query"
import { trimSessions } from "./session-trim"
import { pathKey } from "@/utils/path-key"

export const HOME_V2_SESSION_PAGE_LIMIT = 5_000

export type HomeSessionEvent = {
  type: "session.created" | "session.updated" | "session.deleted"
  properties: { sessionID: string; info: Session }
}
export type HomeSessionEvents = {
  sequence: number
  entries: Array<{ sequence: number; event: HomeSessionEvent }>
}
export type HomeSessionIndex = {
  sessions: Session[]
  archivedSessions?: Session[]
  eventSequence: number
}

export const homeSessionIndexKey = (server: string) => ["home", "session-index", server] as const
export const homeSessionEventsKey = (server: string) => ["home", "session-events", server] as const

type HomeSessionPage = { data?: V2SessionListResponse }

export async function loadHomeSessionIndex(
  list: (
    input: { limit: number; order: "desc"; cursor?: string },
    options: { signal?: AbortSignal },
  ) => Promise<HomeSessionPage>,
  eventSequence = 0,
  signal?: AbortSignal,
) {
  const data: SessionV2Info[] = []
  let cursor: string | undefined

  for (;;) {
    const response = await list(
      {
        limit: HOME_V2_SESSION_PAGE_LIMIT,
        order: "desc",
        ...(cursor ? { cursor } : {}),
      },
      { signal },
    )
    const page = response.data!
    data.push(...page.data)
    if (page.data.length < HOME_V2_SESSION_PAGE_LIMIT || !page.cursor.next)
      return {
        sessions: parseHomeSessionIndex(data),
        archivedSessions: parseArchivedHomeSessionIndex(data),
        eventSequence,
      }
    cursor = page.cursor.next
  }
}

export function appendHomeSessionEvent(current: HomeSessionEvents | undefined, event: HomeSessionEvent) {
  const sequence = (current?.sequence ?? 0) + 1
  return {
    sequence,
    entries: [...(current?.entries ?? []), { sequence, event }],
  }
}

export function trimHomeSessionEvents(current: HomeSessionEvents | undefined, sequence: number): HomeSessionEvents {
  return {
    sequence: current?.sequence ?? sequence,
    entries: (current?.entries ?? []).filter((entry) => entry.sequence > sequence),
  }
}

export function homeSessionIndexSessions(index: HomeSessionIndex | undefined, events: HomeSessionEvents | undefined) {
  if (!index) return []
  return (events?.entries ?? [])
    .filter((entry) => entry.sequence > index.eventSequence)
    .reduce((sessions, entry) => applyHomeSessionEvent(sessions, entry.event), index.sessions)
}

export function homeSessionIndexArchivedSessions(
  index: HomeSessionIndex | undefined,
  events?: HomeSessionEvents | undefined,
) {
  if (!index) return []
  return (events?.entries ?? [])
    .filter((entry) => entry.sequence > index.eventSequence)
    .reduce((sessions, entry) => applyArchivedHomeSessionEvent(sessions, entry.event), index.archivedSessions ?? [])
}

export function homeSessionIndexRefresh(event: Event["type"], connected: boolean) {
  if (event === "server.connected") return { connected: true, refetch: connected }
  return {
    connected,
    refetch: event === "global.disposed" || event === "session.next.moved",
  }
}

export function createHomeSessionIndexCache(queryClient: QueryClient, server: string) {
  const indexKey = homeSessionIndexKey(server)
  const eventsKey = homeSessionEventsKey(server)
  let connected = false
  const removed = new Set<string>()
  const archivedByRemove = new Map<string, Session>()

  return {
    indexKey,
    eventsKey,
    eventSequence() {
      return queryClient.getQueryData<HomeSessionEvents>(eventsKey)?.sequence ?? 0
    },
    complete(sequence: number) {
      // Keep events received after the fetch began so its response cannot overwrite them.
      queryClient.setQueryData<HomeSessionEvents>(eventsKey, (current) => trimHomeSessionEvents(current, sequence))
    },
    sessions(index: HomeSessionIndex | undefined, events: HomeSessionEvents | undefined) {
      const sessions = homeSessionIndexSessions(index, events)
      return removed.size === 0 ? sessions : sessions.filter((session) => !removed.has(session.id))
    },
    archivedSessions(index: HomeSessionIndex | undefined, events?: HomeSessionEvents | undefined) {
      const list = homeSessionIndexArchivedSessions(index, events)
      if (archivedByRemove.size === 0) return list
      const seen = new Set(list.map((session) => session.id))
      const extra = [...archivedByRemove.values()].filter((session) => !seen.has(session.id) && !session.parentID)
      return [...extra, ...list]
    },
    apply(event: HomeSessionEvent) {
      const info = event.properties.info
      if (event.type === "session.deleted") {
        archivedByRemove.delete(info.id)
      } else if (typeof info.time.archived === "number") {
        if (!info.parentID) archivedByRemove.set(info.id, info)
      } else {
        removed.delete(info.id)
        archivedByRemove.delete(info.id)
      }
      if (!queryClient.getQueryState(indexKey)) return
      const next = appendHomeSessionEvent(queryClient.getQueryData<HomeSessionEvents>(eventsKey), event)
      if (queryClient.isFetching({ queryKey: indexKey, exact: true }) > 0) {
        queryClient.setQueryData(eventsKey, next)
        return
      }

      const index = queryClient.getQueryData<HomeSessionIndex>(indexKey)
      if (index) {
        queryClient.setQueryData<HomeSessionIndex>(indexKey, {
          ...index,
          sessions: homeSessionIndexSessions(index, next),
          archivedSessions: homeSessionIndexArchivedSessions(index, next),
          eventSequence: next.sequence,
        })
      }
      queryClient.setQueryData<HomeSessionEvents>(eventsKey, { sequence: next.sequence, entries: [] })
    },
    remove(sessionOrID: Session | string) {
      const sessionID = typeof sessionOrID === "string" ? sessionOrID : sessionOrID.id
      const fallbackSession = typeof sessionOrID === "string" ? undefined : sessionOrID
      removed.add(sessionID)
      if (fallbackSession && !fallbackSession.parentID) {
        archivedByRemove.set(sessionID, {
          ...fallbackSession,
          time: { ...fallbackSession.time, archived: fallbackSession.time.archived ?? Date.now() },
        })
      }
      if (!queryClient.getQueryState(indexKey)) return
      queryClient.setQueryData<HomeSessionIndex>(indexKey, (index) => {
        if (!index) return index
        const at = index.sessions.findIndex((session) => session.id === sessionID)
        const base =
          at !== -1
            ? index.sessions[at]!
            : (fallbackSession ?? (index.archivedSessions ?? []).find((item) => item.id === sessionID))
        const nextSessions = at === -1 ? index.sessions : index.sessions.toSpliced(at, 1)
        if (!base || base.parentID) {
          return at === -1 ? index : { ...index, sessions: nextSessions }
        }
        const archivedItem = {
          ...base,
          time: { ...base.time, archived: base.time.archived ?? Date.now() },
        }
        archivedByRemove.set(sessionID, archivedItem)
        const prevArchived = (index.archivedSessions ?? []).filter((item) => item.id !== sessionID)
        return {
          ...index,
          sessions: nextSessions,
          archivedSessions: [archivedItem, ...prevArchived],
        }
      })
    },
    restore(session: Session) {
      removed.delete(session.id)
      archivedByRemove.delete(session.id)
      if (!queryClient.getQueryState(indexKey)) return
      queryClient.setQueryData<HomeSessionIndex>(indexKey, (index) => {
        if (!index) return index
        const nextSession = {
          ...session,
          time: { ...session.time, archived: undefined },
        }
        const prevArchived = (index.archivedSessions ?? []).filter((item) => item.id !== session.id)
        if (index.sessions.some((item) => item.id === session.id)) {
          return { ...index, archivedSessions: prevArchived }
        }
        return {
          ...index,
          sessions: [nextSession, ...index.sessions],
          archivedSessions: prevArchived,
        }
      })
    },
    refresh(event: Event["type"]) {
      const result = homeSessionIndexRefresh(event, connected)
      connected = result.connected
      if (!result.refetch) return
      void queryClient.refetchQueries({ queryKey: indexKey, exact: true, type: "active" })
    },
  }
}

// TODO(v2): This deliberately dumb full-table scan is necessary because the
// current V2 API orders by creation time and cannot filter roots, archives, or
// multiple directories. A bounded page could omit an old session updated today.
// Once released, use client.v2.project.list() and client.v2.session.list({
// parentID: null, order: "desc" }), then remove this adapter and its V1 fields.
export function parseHomeSessionIndex(sessions: SessionV2Info[]): Session[] {
  return sessions.flatMap((item) => {
    if (item.parentID || typeof item.time.archived === "number") return []
    return [toLegacySummary(item)]
  })
}

export function parseArchivedHomeSessionIndex(sessions: SessionV2Info[]): Session[] {
  return sessions.flatMap((item) => {
    if (item.parentID || typeof item.time.archived !== "number") return []
    return [toLegacySummary(item)]
  })
}

export function retainHomeSessions(sessions: Session[], limit: number, now: number) {
  const grouped = Map.groupBy(sessions, (session) => pathKey(session.directory))
  return [...grouped.values()].flatMap((items) => trimSessions(items, { limit, permission: {}, now }))
}

export function applyHomeSessionEvent(sessions: Session[], event: HomeSessionEvent) {
  const info = event.properties.info
  const index = sessions.findIndex((session) => session.id === info.id)
  if (event.type === "session.deleted" || info.parentID || typeof info.time.archived === "number") {
    if (index === -1) return sessions
    return sessions.toSpliced(index, 1)
  }
  if (event.type !== "session.created" && event.type !== "session.updated") return sessions
  if (index === -1) return [...sessions, info]
  return sessions.with(index, info)
}

export function applyArchivedHomeSessionEvent(sessions: Session[], event: HomeSessionEvent) {
  const info = event.properties.info
  const index = sessions.findIndex((session) => session.id === info.id)
  if (event.type === "session.deleted" || info.parentID || typeof info.time.archived !== "number") {
    if (index === -1) return sessions
    return sessions.toSpliced(index, 1)
  }
  if (event.type !== "session.created" && event.type !== "session.updated") return sessions
  if (index === -1) return [info, ...sessions]
  return sessions.with(index, info)
}

function toLegacySummary(session: SessionV2Info): Session {
  return {
    id: session.id,
    slug: session.id,
    projectID: session.projectID,
    workspaceID: session.location.workspaceID,
    directory: session.location.directory,
    path: session.subpath,
    parentID: session.parentID,
    cost: session.cost,
    tokens: session.tokens,
    title: session.title,
    agent: session.agent,
    model: session.model,
    version: "",
    time: session.time,
  }
}
