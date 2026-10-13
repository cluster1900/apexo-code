import { describe, expect, test } from "bun:test"
import { ConfigPlugin } from "@/config/plugin"

describe("plugin trust options", () => {
  test("defaults to compatibility allow and supports explicit deny", () => {
    expect(ConfigPlugin.pluginTrust("example-plugin")).toBeUndefined()
    expect(ConfigPlugin.pluginTrust(["example-plugin", { trust: "allow" }])).toBe("allow")
    expect(ConfigPlugin.pluginTrust(["example-plugin", { trust: "deny" }])).toBe("deny")
    expect(ConfigPlugin.pluginTrust(["example-plugin", { trust: "unknown" }])).toBeUndefined()
  })
})
