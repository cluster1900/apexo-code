import { base64Encode } from "@apexo/core/util/encode"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

export function migrateAutoAccept(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const choices = Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  )
  for (const [key, enabled] of Object.entries(choices)) {
    if (enabled) continue
    const sessionID = /^[-_A-Za-z0-9]+\/(ses[^/]*)$/.exec(key)?.[1]
    if (!sessionID) continue
    delete choices[key]
    choices[sessionID] = false
  }
  return choices
}

export function setSessionAutoAccept(
  choices: Record<string, boolean>,
  sessionID: string,
  enabled: boolean,
  directory?: string,
) {
  for (const key of Object.keys(choices)) {
    if (key === sessionID || key.endsWith(`/${sessionID}`)) delete choices[key]
  }
  // Persist the opt-out by Session ID. An opt-in applies to the explicitly chosen directory.
  choices[enabled ? acceptKey(sessionID, directory) : sessionID] = enabled
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  if (autoAccept[sessionID] === false) return false
  const key = acceptKey(sessionID, directory)
  return autoAccept[key] ?? autoAccept[sessionID]
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionAutoAccept(autoAccept, session, permission, directory)
  if (value !== undefined) return value
  return directory ? isDirectoryAutoAccepting(autoAccept, directory) : false
}

export function sessionAutoAccept(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
}
