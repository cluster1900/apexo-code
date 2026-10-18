import { describe, expect, test } from "bun:test"
import { grokPluginArgs } from "../../src/cli/cmd/plugins"

describe("grokPluginArgs", () => {
  test("keeps the npm installer for module names", () => {
    expect(grokPluginArgs(["plugin", "@scope/my-plugin"])).toEqual(["plugin", "@scope/my-plugin"])
    expect(grokPluginArgs(["plugins", "list"])).toEqual(["plugins", "list"])
    expect(grokPluginArgs(["run", "plugin", "list"])).toEqual(["run", "plugin", "list"])
  })
  test("maps Grok Build plugin subcommands", () => {
    expect(grokPluginArgs(["plugin", "list"])).toEqual(["plugins", "list", "--installed"])
    expect(grokPluginArgs(["plugin", "list", "--json", "--available"])).toEqual(["plugins", "list", "--json"])
    expect(grokPluginArgs(["plugin", "install", "./p", "--trust"])).toEqual(["plugins", "install", "./p", "--trust"])
    expect(grokPluginArgs(["plug", "rm", "x", "--confirm", "--keep-data"])).toEqual([
      "plugins",
      "uninstall",
      "x",
      "--keep-data",
    ])
    expect(grokPluginArgs(["--print-logs", "plugin", "details", "x"])).toEqual([
      "--print-logs",
      "plugins",
      "details",
      "x",
    ])
  })
  test("maps marketplace management to sources", () => {
    expect(grokPluginArgs(["plugin", "marketplace", "add", "org/repo"])).toEqual(["plugins", "add-source", "org/repo"])
    expect(grokPluginArgs(["plugin", "marketplace", "list"])).toEqual(["plugins", "sources"])
    expect(grokPluginArgs(["plugin", "marketplace", "update"])).toEqual(["plugins", "refresh"])
    expect(grokPluginArgs(["plugin", "marketplace", "remove", "u"])).toEqual(["plugins", "remove-source", "u"])
  })
})
