import { expect, test } from "bun:test"
import { MonitorEvents } from "@apexo/core/monitor-events"

test("monitor buffers partial lines, normalizes CRLF and flushes the final line once", () => {
  const monitor = MonitorEvents.create()
  expect(monitor.push("partial", 0).events).toEqual([])
  expect(monitor.push(" line\r\n\nlast", 1).events).toEqual(["partial line"])
  expect(monitor.push("", 2, true).events).toEqual(["last"])
  expect(monitor.push("", 3, true).events).toEqual([])
})

test("monitor bounds long unterminated lines without splitting Unicode characters", () => {
  const monitor = MonitorEvents.create()
  expect(monitor.push("😀".repeat(700_000), 0).events).toEqual([])
  expect(monitor.push("rest\n", 1).events).toEqual(["😀".repeat(500) + "… [line truncated]"])
  expect(monitor.push("next\n", 2).events).toEqual(["next"])
})

test("monitor limits bursts and reports suppressed events when its token bucket refills", () => {
  const monitor = MonitorEvents.create()
  const burst = monitor.push(Array.from({ length: 12 }, (_, n) => `line ${n}\n`).join(""), 0)
  expect(burst.events).toHaveLength(10)
  expect(burst.lines).toBe(12)
  expect(monitor.push("throttled\n", 1_999).events).toEqual([])
  expect(monitor.push("refilled\n", 2_000).events).toEqual([
    "[3 monitor events suppressed; filter the command output.]",
    "refilled",
  ])
})

test("monitor stops sustained overload and never produces later events", () => {
  const monitor = MonitorEvents.create()
  Array.from({ length: 31 }, (_, second) => second * 1_000).forEach((now) => {
    expect(monitor.push("event\n".repeat(12), now).stopped).toBe(false)
  })
  const result = monitor.push("event\n", 30_001)
  expect(result.stopped).toBe(true)
  expect(result.events.at(-1)).toContain("Monitor stopped")
  expect(monitor.push("late\n", 60_000).events).toEqual([])
})

test("monitor resets the overload window after the output becomes quiet", () => {
  const monitor = MonitorEvents.create()
  monitor.push("event\n".repeat(12), 0)
  expect(monitor.push("quiet\n", 10_000).stopped).toBe(false)
  expect(monitor.push("event\n".repeat(12), 30_001).stopped).toBe(false)
})
