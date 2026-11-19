import { expect, test } from "bun:test"
import { SessionID } from "@apexo/schema/session-id"
import {
  acceptKey,
  autoRespondsPermission,
  directoryAcceptKey,
  directoryAutoAccept,
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

test("verified worktree aliases share approval choices with an explicit opt-out taking precedence", () => {
  const sessionID = SessionID.create()
  const choices = { [directoryAcceptKey(previous)]: true }
  expect(autoRespondsPermission(choices, [], { sessionID }, current, [previous])).toBe(true)
  expect(autoRespondsPermission(choices, [], { sessionID }, current)).toBe(false)

  const conflicting = { ...choices, [directoryAcceptKey(current)]: false }
  expect(directoryAutoAccept(conflicting, previous, [current])).toBe(false)
  expect(directoryAutoAccept(conflicting, current, [previous])).toBe(false)
  expect(directoryAutoAccept(conflicting, current + "-other")).toBeUndefined()
})

test("a session opt-in follows only its verified worktree aliases", () => {
  const sessionID = SessionID.create()
  const choices = { [acceptKey(sessionID, previous)]: true }
  expect(autoRespondsPermission(choices, [], { sessionID }, current, [previous])).toBe(true)
  expect(autoRespondsPermission(choices, [], { sessionID }, current)).toBe(false)
  expect(
    autoRespondsPermission(
      migrateAutoAccept({ ...choices, [acceptKey(sessionID, current)]: false }),
      [],
      { sessionID },
      previous,
      [current],
    ),
  ).toBe(false)
})
