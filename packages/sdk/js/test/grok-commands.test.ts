import { describe, expect, test } from "bun:test"
import {
  vimScrollAction,
  contextUsage,
  parseSlashInput,
  promptHistory,
  releaseNotesURL,
  resolveDocs,
  resolveEffort,
} from "../src/v2/grok-commands"

describe("grok commands", () => {
  test("parseSlashInput", () => {
    expect(parseSlashInput("/effort high")).toEqual({ name: "effort", args: "high" })
    expect(parseSlashInput("  /docs  ")).toEqual({ name: "docs", args: "" })
    expect(parseSlashInput("/plan add caching\nwith tests")).toEqual({ name: "plan", args: "add caching\nwith tests" })
    expect(parseSlashInput("hello /effort")).toBeUndefined()
  })
  test("resolveEffort maps Grok levels onto model variants", () => {
    expect(resolveEffort("HIGH", ["low", "medium", "high"])).toBe("high")
    expect(resolveEffort("xhigh", ["low", "max"])).toBe("max")
    expect(resolveEffort("xhigh", ["low"])).toBeUndefined()
    expect(resolveEffort("", ["low"])).toBeUndefined()
  })
  test("resolveDocs", () => {
    expect(resolveDocs("")).toBeUndefined()
    expect(resolveDocs("how-to")).toBeUndefined()
    expect(resolveDocs("web")?.title).toBe("Docs")
    expect(resolveDocs("getting started")?.title).toBe("Getting Started")
    expect(resolveDocs("goal")?.title).toBe("Goals")
  })
  test("releaseNotesURL", () => {
    expect(releaseNotesURL("1.2.3")).toEndWith("/releases/tag/v1.2.3")
    expect(releaseNotesURL("local")).toEndWith("/releases")
  })
  test("contextUsage uses the latest assistant turn", () => {
    const tokens = (input: number) => ({ input, output: 10, reasoning: 5, cache: { read: 100, write: 0 } })
    expect(
      contextUsage(
        [
          { role: "assistant", tokens: tokens(1) },
          { role: "user" },
          { role: "assistant", tokens: tokens(200) },
          { role: "assistant", tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        ],
        1000,
      ),
    ).toEqual({ used: 315, limit: 1000, input: 200, output: 10, reasoning: 5, cache: 100 })
    expect(contextUsage([{ role: "user" }], 1000)).toBeUndefined()
  })
  test("promptHistory is newest first, deduplicated and fuzzy", () => {
    expect(promptHistory(["fix tests", "add docs", "fix tests", "deploy"])).toEqual(["deploy", "fix tests", "add docs"])
    expect(promptHistory(["fix tests", "add docs"], "ft")).toEqual(["fix tests"])
  })
})

describe("vimScrollAction", () => {
  test("maps the documented scrollback keys", () => {
    expect(vimScrollAction({ name: "j" })?.action).toBe("line.down")
    expect(vimScrollAction({ name: "k" })?.action).toBe("line.up")
    expect(vimScrollAction({ name: "h" })?.action).toBe("message.previous")
    expect(vimScrollAction({ name: "l" })?.action).toBe("message.next")
    expect(vimScrollAction({ name: "g" })?.action).toBe("first")
    expect(vimScrollAction({ name: "g", shift: true })?.action).toBe("last")
    expect(vimScrollAction({ char: "G" })?.action).toBe("last")
    expect(vimScrollAction({ char: "g", shift: true })?.action).toBe("last")
    expect(vimScrollAction({ name: "y" })?.action).toBe("copy.message")
    expect(vimScrollAction({ name: "y", shift: true })?.action).toBe("copy.transcript")
    expect(vimScrollAction({ name: "d", ctrl: true })?.action).toBe("half.down")
    expect(vimScrollAction({ name: "u", ctrl: true })?.action).toBe("half.up")
  })
  test("other keys return to the prompt and type the character", () => {
    expect(vimScrollAction({ name: "i" })).toEqual({ action: "prompt" })
    expect(vimScrollAction({ name: "return" })).toEqual({ action: "prompt" })
    expect(vimScrollAction({ name: "x" })).toEqual({ action: "prompt", type: "x" })
    expect(vimScrollAction({ char: "?" })).toEqual({ action: "prompt", type: "?" })
    expect(vimScrollAction({ name: "escape" })).toBeUndefined()
    expect(vimScrollAction({ name: "x", alt: true })).toBeUndefined()
  })
})
