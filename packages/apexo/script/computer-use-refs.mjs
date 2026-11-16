import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { poll } from "./grok-shell-fixture.mjs"

const output = await mkdtemp(join(tmpdir(), "apexo-computer-use-refs-"))
const bundle = resolve(process.env.COMPUTER_USE_BUNDLE ?? "../../plugins/computer-use/dist/computer-use-darwin-arm64")
const checks = []
const peer = async () => {
  const client = new Client({ name: "apexo-computer-use-acceptance", version: "1" })
  await client.connect(
    new StdioClientTransport({
      command: join(bundle, "bin/mcp"),
      env: { PATH: "/usr/bin:/bin", AGENT_DESKTOP_HOME: join(output, "data") },
      stderr: "pipe",
    }),
  )
  return client
}
const envelope = (result) =>
  result.structuredContent ?? JSON.parse(result.content.find((part) => part.type === "text").text)
const refs = (node) =>
  node && typeof node === "object"
    ? [
        ...(typeof node.ref_id === "string" ? [node.ref_id] : []),
        ...Object.values(node).flatMap((value) => (Array.isArray(value) ? value.flatMap(refs) : refs(value))),
      ]
    : []
const editableRefs = (node) =>
  node && typeof node === "object"
    ? [
        ...(typeof node.ref_id === "string" && /text|entry/i.test(node.role ?? "") ? [node.ref_id] : []),
        ...Object.values(node).flatMap((value) =>
          Array.isArray(value) ? value.flatMap(editableRefs) : editableRefs(value),
        ),
      ]
    : []
const filename = `Computer Use stale ${crypto.randomUUID().slice(0, 8)}.txt`
const file = join(output, filename)
await writeFile(file, "Untouched fixture.\n")
assert.equal(Bun.spawnSync(["/usr/bin/open", "-a", "TextEdit", file]).exitCode, 0)
const first = await peer()
let second
try {
  const window = await poll(
    async () =>
      envelope(await first.callTool({ name: "desktop_list_windows", arguments: { app: "TextEdit" } })).data.find(
        (window) => window.title?.includes(filename),
      ),
    "fixture TextEdit window appears",
    15_000,
  )
  const catalog = await first.listTools()
  assert.ok(catalog.tools.some((tool) => tool.name === "desktop_screenshot"))
  const initial = envelope(await first.callTool({ name: "desktop_status", arguments: {} })).data
  const snapshot = await first.callTool({
    name: "desktop_snapshot",
    arguments: { app: "TextEdit", window_id: window.id, compact: true },
  })
  assert.ok(!snapshot.isError, JSON.stringify(snapshot.content))
  const oldRef = refs(envelope(snapshot).data)[0]
  assert.ok(oldRef)
  assert.equal((await stat(join(output, "data"))).mode & 0o777, 0o700)
  const image = await first.callTool({
    name: "desktop_screenshot",
    arguments: { app: "TextEdit", window_id: window.id },
  })
  assert.ok(
    image.content.some((part) => part.type === "image" && part.mimeType === "image/png"),
    JSON.stringify(image.content),
  )
  checks.push("actual-bundle-minimal-path-private-data-and-inline-image")
  await first.close()
  second = await peer()
  const current = envelope(await second.callTool({ name: "desktop_status", arguments: {} })).data
  assert.notEqual(current.session_id, initial.session_id)
  assert.equal(current.tracing, false)
  const previous = await second.callTool({ name: "desktop_get", arguments: { ref_id: oldRef } })
  assert.equal(previous.isError, true)
  assert.equal(envelope(previous).error.code, "SNAPSHOT_NOT_FOUND")
  checks.push("new-connection-rejects-old-namespace-ref")
  const next = await second.callTool({
    name: "desktop_snapshot",
    arguments: { app: "TextEdit", window_id: window.id, compact: true },
  })
  const stale = editableRefs(envelope(next).data)[0]
  assert.ok(stale)
  const value = await second.callTool({ name: "desktop_get", arguments: { ref_id: stale, property: "value" } })
  assert.equal(value.isError, false)
  assert.match(JSON.stringify(value.content), /Untouched fixture/)
  const close = Bun.spawnSync([
    "/usr/bin/osascript",
    "-e",
    `tell application "TextEdit" to close (first document whose name is ${JSON.stringify(filename)}) saving no`,
  ])
  assert.equal(close.exitCode, 0, close.stderr.toString())
  const action = await second.callTool({
    name: "desktop_set_value",
    arguments: { ref_id: stale, value: "MUST_NOT_APPEAR" },
  })
  assert.equal(action.isError, true)
  await writeFile(join(output, "closed-target-error.json"), JSON.stringify(envelope(action).error, null, 2))
  assert.match(
    envelope(action).error.code,
    /STALE_REF|WINDOW_NOT_FOUND|SNAPSHOT_NOT_FOUND|ELEMENT_NOT_FOUND|ACTION_FAILED/,
  )
  const delivery = envelope(action).error.disposition
  assert.ok(["not_delivered", "delivered_unverified"].includes(delivery.delivery))
  if (delivery.delivery === "delivered_unverified") assert.equal(delivery.retry, "unsafe")
  assert.equal(await readFile(file, "utf8"), "Untouched fixture.\n")
  checks.push("closed-target-reports-failure-or-uncertain-delivery-without-file-change")
  console.log(JSON.stringify({ passed: checks.length, checks, output }))
} finally {
  await first.close()
  await second?.close()
  await writeFile(join(output, "result.json"), JSON.stringify({ checks }, null, 2))
}
