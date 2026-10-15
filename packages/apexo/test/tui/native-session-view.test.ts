import { expect, test } from "bun:test"
import { Event } from "@apexo/schema/event"
import { SessionID } from "@apexo/schema/session-id"
import { SessionMessage } from "@apexo/schema/session-message"
import { nativeSessionView } from "@apexo/tui/transport/native-session-view"

function transcript() {
  const sessionID = SessionID.create()
  const user = SessionMessage.ID.create()
  const assistant = SessionMessage.ID.create()
  const event = (type: string, data: Record<string, unknown>, seq?: number) => ({
    id: Event.ID.create(),
    type,
    data: { timestamp: 1000, sessionID, ...data },
    ...(seq === undefined ? {} : { durable: { aggregateID: sessionID, seq, version: 1 } }),
  })
  return {
    sessionID,
    user,
    assistant,
    event,
    initial: [
      event("session.next.prompted", { messageID: user, prompt: { text: "hello" }, delivery: "steer" }, 2),
      event(
        "session.next.step.started",
        { assistantMessageID: assistant, agent: "build", model: { id: "test", providerID: "test" } },
        3,
      ),
      event("session.next.text.started", { assistantMessageID: assistant, textID: "answer" }, 4),
    ],
  }
}

test("native view reuses full-value settlement and ignores buffered fragments after it", () => {
  const fixture = transcript()
  const view = nativeSessionView(fixture.sessionID, "/workspace")
  fixture.initial.forEach((event) => view.apply(event))
  const delta = fixture.event("session.next.text.delta", {
    assistantMessageID: fixture.assistant,
    textID: "answer",
    delta: "old",
  })
  expect(view.apply(delta)).toBe(true)
  expect(view.apply(delta)).toBe(false)
  view.apply(
    fixture.event(
      "session.next.text.ended",
      { assistantMessageID: fixture.assistant, textID: "answer", text: "complete" },
      5,
    ),
  )
  expect(
    view.apply(
      fixture.event("session.next.text.delta", {
        assistantMessageID: fixture.assistant,
        textID: "answer",
        delta: "late",
      }),
    ),
  ).toBe(false)
  expect(view.snapshot().map((row) => row.info.id)).toEqual([fixture.user, fixture.assistant])
  expect(view.snapshot()[1].parts).toContainEqual({
    id: "answer",
    sessionID: fixture.sessionID,
    messageID: fixture.assistant,
    type: "text",
    text: "complete",
    time: { start: 1000, end: undefined },
  })
  expect(view.sequence).toBe(5)
})

test("native replay is ordered and duplicate durable events cannot duplicate messages", () => {
  const fixture = transcript()
  const view = nativeSessionView(fixture.sessionID, "/workspace")
  fixture.initial.forEach((event) => view.apply(event))
  fixture.initial.forEach((event) => expect(view.apply(event)).toBe(false))
  expect(view.snapshot()).toHaveLength(2)
  view.reset()
  expect(view.snapshot()).toEqual([])
  expect(view.sequence).toBe(0)
  fixture.initial.forEach((event) => view.apply(event))
  expect(view.snapshot()).toHaveLength(2)
})

test("native view rejects malformed wire payloads and does not adopt another Session", () => {
  const fixture = transcript()
  const view = nativeSessionView(fixture.sessionID, "/workspace")
  expect(() => view.apply({ ...fixture.initial[0], data: { sessionID: fixture.sessionID } })).toThrow()
  const other = transcript()
  expect(view.apply(other.initial[0])).toBe(false)
  expect(view.snapshot()).toEqual([])
})
