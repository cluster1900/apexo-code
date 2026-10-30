import { describe, expect, test } from "bun:test"
import { parseBrowserCommand } from "../src/v2/browser-command"

describe("parseBrowserCommand", () => {
  test("keeps a bare command as an explicit help action", () => {
    expect(parseBrowserCommand()).toMatchObject({ action: "help" })
  })

  test("parses open with a CDP URL", () => {
    expect(parseBrowserCommand('open "http://127.0.0.1:3000" --cdp-url http://127.0.0.1:9222')).toEqual({
      action: "open",
      url: "http://127.0.0.1:3000",
      cdpUrl: "http://127.0.0.1:9222",
    })
  })

  test("preserves quoted text for type", () => {
    expect(parseBrowserCommand('type "#name" "Apexo User"')).toEqual({
      action: "type",
      selector: "#name",
      text: "Apexo User",
    })
  })

  test("parses cursor options and rejects invalid values", () => {
    expect(parseBrowserCommand("events 12 40")).toEqual({ action: "events", after: 12, limit: 40 })
    expect(parseBrowserCommand("scroll nope 2").action).toBe("help")
  })
})
