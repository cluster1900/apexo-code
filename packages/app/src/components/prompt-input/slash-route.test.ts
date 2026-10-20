import { describe, expect, test } from "bun:test"
import { findSlashOption, runSlashOption, type CommandOption } from "@/context/command"
import { registeredSlash, sideQuestion } from "./slash-route"

describe("registeredSlash", () => {
  test("typed arguments and a trailing space still name the registered command", () => {
    expect(registeredSlash("/rename Better title", [])).toEqual({ name: "rename", args: "Better title" })
    expect(registeredSlash("/copy ", [])).toEqual({ name: "copy", args: "" })
    expect(registeredSlash("  /resume  release notes ", [])).toEqual({ name: "resume", args: "release notes" })
  })

  test("server commands keep their own route", () => {
    expect(registeredSlash("/review src/app.ts", ["review"])).toBeUndefined()
  })

  test("commands the submit path routes after creating a session are left alone", () => {
    expect(registeredSlash("/goal ship it --budget 10", [])).toBeUndefined()
    expect(registeredSlash("/remember use bun", [])).toBeUndefined()
    expect(registeredSlash("/flush", [])).toBeUndefined()
    expect(registeredSlash("/dream extra", [])).toEqual({ name: "dream", args: "extra" })
  })

  test("plain prompts and paths are not slash commands", () => {
    expect(registeredSlash("explain /rename", [])).toBeUndefined()
    expect(registeredSlash("/tmp/out.txt is empty", [])).toBeUndefined()
    expect(registeredSlash("/Users/me explain", [])).toBeUndefined()
  })
})

describe("sideQuestion", () => {
  test("leading and mid-message /btw become the side question", () => {
    expect(sideQuestion("/btw what is WBC?")).toBe("what is WBC?")
    expect(sideQuestion("fix the retry loop first. /btw what does WBC stand for?")).toBe(
      "fix the retry loop first. what does WBC stand for?",
    )
  })

  test("a bare /btw opens an empty side question", () => {
    expect(sideQuestion("/btw")).toBe("")
    expect(sideQuestion("  /btw  ")).toBe("")
  })

  test("messages without a standalone /btw token are not side questions", () => {
    expect(sideQuestion("read docs/btw.md")).toBeUndefined()
    expect(sideQuestion("use /btwx here")).toBeUndefined()
  })
})

describe("registered slash dispatch", () => {
  const calls: string[] = []
  const options: CommandOption[] = [
    { id: "suggested.session.rename", title: "Rename", slash: "rename", onSelect: () => calls.push("suggested") },
    {
      id: "session.rename",
      title: "Rename",
      slash: "rename",
      slashAliases: ["title"],
      onSelect: () => calls.push("editor"),
      onSlash: (args) => calls.push(`rename:${args}`),
    },
    { id: "status.old", title: "Old", slash: "status", disabled: true, onSelect: () => calls.push("old") },
    { id: "session.info", title: "Info", slash: "session-info", slashAliases: ["status"], onSelect: () => calls.push("info") },
    { id: "theme.cycle", title: "Theme", slash: "themes", slashAliases: ["t"], onSelect: () => calls.push("theme") },
  ]

  test("finds commands by slash or alias, skipping suggested copies and preferring enabled duplicates", () => {
    expect(findSlashOption(options, "title")?.id).toBe("session.rename")
    expect(findSlashOption(options, "status")?.id).toBe("session.info")
    expect(findSlashOption(options, "missing")).toBeUndefined()
  })

  test("arguments go to onSlash; commands without it run onSelect and ignore them", () => {
    calls.length = 0
    runSlashOption(findSlashOption(options, "rename")!, "New title")
    runSlashOption(findSlashOption(options, "rename")!, "")
    runSlashOption(findSlashOption(options, "t")!, "ignored")
    expect(calls).toEqual(["rename:New title", "editor", "theme"])
  })
})
