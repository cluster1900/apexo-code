import { describe, expect, test } from "bun:test"
import { parseComputerCommand } from "../src/v2/computer-command"

describe("parseComputerCommand", () => {
  test("uses the bare command as the manual open trigger", () => {
    expect(parseComputerCommand("")).toEqual({ action: "open" })
  })

  test("parses coordinates and quoted typing", () => {
    expect(parseComputerCommand("click 120 240")).toEqual({ action: "click", x: 120, y: 240 })
    expect(parseComputerCommand('type "Close this window"')).toEqual({ action: "type", text: "Close this window" })
  })

  test("parses observation, capture, and event cursor commands", () => {
    expect(parseComputerCommand("snapshot")).toEqual({ action: "observe" })
    expect(parseComputerCommand("screenshot")).toEqual({ action: "screenshot" })
    expect(parseComputerCommand("events 12 40")).toEqual({ action: "events", after: 12, limit: 40 })
  })

  test("rejects malformed coordinates and cursors", () => {
    expect(parseComputerCommand("click nope 2").action).toBe("help")
    expect(parseComputerCommand("scroll nope").action).toBe("help")
    expect(parseComputerCommand("events 1.5").action).toBe("help")
  })
})
