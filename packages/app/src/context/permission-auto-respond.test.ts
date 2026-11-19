import { expect, test } from "bun:test"
import { SessionID } from "@apexo/schema/session-id"
import {
  acceptKey,
  autoRespondsPermission,
  directoryAcceptKey,
  migrateAutoAccept,
  setSessionAutoAccept,
} from "./permission-auto-respond"

const previous = "/data/opencode/worktree/checkout"
const current = "/data/apexo/worktree/checkout"

test("saved session opt-outs survive a path change and take precedence over an automatic approval", () => {
  const sessionID = SessionID.create()
  const child = SessionID.create()
  const other = SessionID.create()
  const sessions = [{ id: sessionID }, { id: child, parentID: sessionID }, { id: other }]
  const choices = migrateAutoAccept({
    [acceptKey(sessionID, previous)]: false,
    [acceptKey(sessionID, current)]: true,
    [directoryAcceptKey(current)]: true,
    [directoryAcceptKey(previous)]: false,
  })
  expect(autoRespondsPermission(choices, sessions, { sessionID }, current)).toBe(false)
  expect(autoRespondsPermission(choices, sessions, { sessionID: child }, current)).toBe(false)
  expect(autoRespondsPermission(choices, sessions, { sessionID: other }, current)).toBe(true)

  setSessionAutoAccept(choices, sessionID, true, current)
  const reloaded = migrateAutoAccept(choices)
  expect(autoRespondsPermission(reloaded, sessions, { sessionID }, current)).toBe(true)
  expect(autoRespondsPermission(reloaded, sessions, { sessionID }, previous)).toBe(false)
})

test("a new opt-out clears the older path-scoped grant and stays off after reload", () => {
  const sessionID = SessionID.create()
  const choices = {
    [acceptKey(sessionID, previous)]: true,
    [directoryAcceptKey(current)]: true,
  }
  setSessionAutoAccept(choices, sessionID, false)
  const reloaded = migrateAutoAccept(choices)
  expect(reloaded[acceptKey(sessionID, previous)]).toBeUndefined()
  expect(autoRespondsPermission(reloaded, [{ id: sessionID }], { sessionID }, current)).toBe(false)
})
