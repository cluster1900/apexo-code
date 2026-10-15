import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@apexo/core/config"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { ConfigMigrateV1 } from "@apexo/core/v1/config/migrate"

test("native and migrated config retain Shell foreground wait settings", () => {
  const toolset = { bash: { default_block_until_ms: 0, max_block_until_ms: 50, max_timeout_secs: 0.1 } }
  const legacy = Schema.decodeUnknownSync(ConfigV1.Info)({ snapshot: false, toolset })
  expect(legacy.toolset).toEqual(toolset)
  expect(Reflect.get(ConfigMigrateV1.migrate(legacy), "toolset")).toEqual(toolset)
  expect(Reflect.get(Schema.decodeUnknownSync(Config.Info)({ snapshots: false, toolset }), "toolset")).toEqual(toolset)
  const native = Schema.toJsonSchemaDocument(Config.Info)
  expect(JSON.stringify(native)).toContain('"toolset"')
  expect(JSON.stringify(native)).toContain('"default_block_until_ms"')
})

test("native Shell prefix and character limit preserve zero and reject invalid limits", () => {
  const toolset = { bash: { cmd_prefix: "export OWNED=1", output_byte_limit: 0 } }
  const legacy = Schema.decodeUnknownSync(ConfigV1.Info)({ snapshot: false, toolset })
  expect(legacy.toolset).toEqual(toolset)
  expect(Reflect.get(ConfigMigrateV1.migrate(legacy), "toolset")).toEqual(toolset)
  expect(Schema.decodeUnknownSync(Config.Info)({ snapshots: false, toolset }).toolset).toEqual(toolset)
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "4"])
    expect(() => Schema.decodeUnknownSync(Config.Info)({ toolset: { bash: { output_byte_limit: value } } })).toThrow()
  expect(
    Schema.decodeUnknownSync(Config.Info)({ toolset: { bash: { output_byte_limit: Number.MAX_SAFE_INTEGER } } }).toolset
      ?.bash?.output_byte_limit,
  ).toBe(Number.MAX_SAFE_INTEGER)
})
