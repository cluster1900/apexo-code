import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture(process.argv[2] ?? "cli")
try {
  const catalog = await runtime.api("/plugins/manage", { action: "refresh" })
  assert.ok(catalog.items.length > 10)
  assert.ok(catalog.items.every((item) => item.recommended))
  assert.ok(catalog.sources.every((source) => !source.error))
  const item = catalog.items.find((item) => item.name === "neon")
  assert.ok(item)
  const downloaded = await runtime.api("/plugins/manage", { action: "download", id: item.id })
  const saved = downloaded.items.find((v) => v.id === item.id)
  assert.equal(saved.status, "downloaded")
  assert.ok(saved.components.length)
  assert.ok(saved.path)
  const registry = JSON.parse(
    await readFile(join(runtime.env.XDG_DATA_HOME, "apexo", "plugins", "registry.json"), "utf8"),
  )
  assert.equal(registry.installed[0].trusted, false)
  assert.equal(registry.installed[0].item.revision, item.revision)
  const result = { source: catalog.sources[0], count: catalog.items.length, plugin: saved, output: runtime.output }
  await writeFile(join(runtime.output, "plugins-recommended.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await runtime.close()
}
