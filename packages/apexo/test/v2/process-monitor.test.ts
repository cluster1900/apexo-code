import { expect, test } from "bun:test"
import { Schema } from "effect"
import { MonitorTool } from "@apexo/core/tool/monitor"
import { SessionProcess } from "@apexo/schema/session-process"
import { SessionID } from "@apexo/schema/session-id"
import { SessionProcessMonitor } from "@apexo/core/session/process-monitor"

const chunk = (text: string, channel: "stdout" | "stderr" = "stdout") => ({ channel, data: Buffer.from(text) })

test("native Monitor batches both pipes, preserves split UTF-8 and flushes final partial lines once", () => {
  const monitor = SessionProcessMonitor.make()
  const emoji = Buffer.from("😀")
  monitor.push({ channel: "stdout", data: emoji.subarray(0, 2) })
  monitor.push(chunk("error\n", "stderr"))
  monitor.push({ channel: "stdout", data: Buffer.concat([emoji.subarray(2), Buffer.from("\r\n\npartial")]) })
  expect(monitor.flush(0)).toBe("error\n😀")
  monitor.finish()
  expect(monitor.flush(200)).toBe("partial")
  monitor.finish()
  expect(monitor.flush(400)).toBeUndefined()
  expect(monitor.read()).toEqual({ accepted: 2, suppressed: 0, overloaded: false })
})

test("native Monitor charges one token for a batch rather than each line", () => {
  const monitor = SessionProcessMonitor.make()
  monitor.push(chunk("line\n".repeat(100)))
  expect(monitor.flush(0)?.split("\n")).toHaveLength(100)
  expect(monitor.read().accepted).toBe(1)
  for (let index = 1; index < 10; index++) {
    monitor.push(chunk("next\n"))
    expect(monitor.flush(index)).toBe("next")
  }
  monitor.push(chunk("suppressed\n"))
  expect(monitor.flush(100)).toBeUndefined()
  monitor.push(chunk("refilled\n"))
  expect(monitor.flush(2000)).toBe("[1 monitor batches suppressed; filter the command output.]\nrefilled")
})

test("native Monitor bounds unterminated Unicode lines and whole pending batches", () => {
  const monitor = SessionProcessMonitor.make()
  monitor.push(chunk("😀".repeat(100_000)))
  expect(monitor.flush(0)).toBeUndefined()
  monitor.push(chunk("\n"))
  expect(monitor.flush(1)).toBe("😀".repeat(500) + "… [line truncated]")
  monitor.push(chunk("abcdef\n".repeat(10_000)))
  const result = monitor.flush(2)!
  expect(Array.from(result.replace("\n[batch truncated]", ""))).toHaveLength(3000)
  expect(result.endsWith("\n[batch truncated]")).toBe(true)
})

test("native Monitor records sustained overload once and clear discards pre-rearm partial and queued lines", () => {
  const monitor = SessionProcessMonitor.make()
  for (let now = 0; now <= 33_000; now += 200) {
    monitor.push(chunk("noisy\n"))
    monitor.flush(now)
  }
  expect(monitor.read().overloaded).toBe(true)
  monitor.push(chunk("late\n"))
  expect(monitor.flush(40_000)).toBeUndefined()
  const fresh = SessionProcessMonitor.make()
  fresh.push(chunk("old\npartial"))
  fresh.clear()
  fresh.push(chunk("future\n"))
  expect(fresh.flush(0)).toBe("future")
})

test("Monitor options preserve reference bounds and old Shell summaries omit additive metadata", () => {
  const input = Schema.decodeUnknownSync(MonitorTool.Input)
  expect(input({ command: "watch", description: "Events", timeout_ms: 0 }).timeout_ms).toBe(0)
  expect(input({ command: "watch", description: "Events", timeout_ms: null }).timeout_ms).toBeNull()
  expect(() => input({ command: "watch", description: "Events", timeout_ms: 36000001 })).toThrow()
  expect(input({ command: "watch", description: "Events", timeout_ms: 36000001, persistent: true }).persistent).toBe(
    true,
  )
  expect(() => input({ command: "watch", description: "Events", timeout_ms: -1 })).toThrow()
  expect(() => input({ command: "watch", description: "Events", timeout_ms: 0.5 })).toThrow()
  expect(() => input({ command: " ", description: "Events" })).toThrow()
  const shell = {
    id: SessionProcess.ID.create(),
    sessionID: SessionID.create(),
    kind: "shell" as const,
    description: "Old Shell",
    status: "running" as const,
    background: true,
    startedAt: 1,
    truncated: false,
  }
  const encoded = Schema.encodeSync(SessionProcess.Summary)({ ...shell, monitor: undefined })
  expect(Object.hasOwn(encoded, "monitor")).toBe(false)
  expect(Schema.decodeUnknownSync(SessionProcess.Summary)(encoded)).toEqual(shell)
  const monitor = {
    ...shell,
    kind: "monitor" as const,
    monitor: { persistent: true, timeoutMs: 0, accepted: 2, suppressed: 1, overloaded: false },
  }
  expect(Schema.decodeUnknownSync(SessionProcess.Summary)(Schema.encodeSync(SessionProcess.Summary)(monitor))).toEqual(
    monitor,
  )
})
