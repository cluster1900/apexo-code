import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import https from "node:https"
import http from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const home = await mkdtemp(join(tmpdir(), "apexo-hooks-network-"))
const ca = fileURLToPath(new URL("../test/fixture/hook-tls/ca.pem", import.meta.url))
const hits = []
const server = https.createServer(
  {
    key: await readFile(new URL("../test/fixture/hook-tls/key.pem", import.meta.url)),
    cert: await readFile(new URL("../test/fixture/hook-tls/cert.pem", import.meta.url)),
  },
  async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    hits.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString()) })
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/redirect-target" })
      response.end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "Trusted HTTPS policy denied read",
        },
      }),
    )
  },
)
const clear = http.createServer(async (request, response) => {
  for await (const chunk of request) {
  }
  hits.push({ path: "cleartext" })
  response.end("{}")
})
await Promise.all([
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)),
  new Promise((resolve) => clear.listen(0, "127.0.0.1", resolve)),
])
await mkdir(join(home, "hooks"))
await writeFile(
  join(home, "hooks/network.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Read",
          hooks: [
            { type: "http", url: `http://127.0.0.1:${clear.address().port}/clear` },
            { type: "http", url: "https://169.254.169.254/blocked", timeout: 0.2 },
            { type: "http", url: `https://127.0.0.1:${server.address().port}/redirect` },
            {
              type: "http",
              url: "${HOOK_ENDPOINT}/policy",
              env: { HOOK_ENDPOINT: `https://127.0.0.1:${server.address().port}` },
            },
          ],
        },
      ],
    },
  }),
)
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home, GROK_EXTRA_CA_BUNDLE: ca },
  next({ finished, ancillary }) {
    return finished || ancillary
      ? { content: "HOOK_NETWORK_DONE" }
      : { tool: "read_file", args: { target_file: "network-target.txt", offset: 0, limit: 10 } }
  },
})
try {
  await writeFile(join(runtime.directory, "network-target.txt"), "NO_UNAPPROVED_CONTENT")
  const session = await runtime.api("/session", { title: "HTTPS host hook policy" })
  await runtime.api(`/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Read network target" }],
  })
  const part = await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`))
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.tool === "read_file" && part.state.status === "error"),
    "HTTPS hook denied read",
  )
  assert.match(part.state.error, /Trusted HTTPS policy denied read/)
  assert.deepEqual(
    hits.map((hit) => hit.path),
    ["/redirect", "/policy"],
  )
  assert.equal(hits[1].body.session_id, session.id)
  assert.equal(hits[1].body.tool_input.target_file, "network-target.txt")
} finally {
  await runtime.close()
  server.closeAllConnections()
  clear.closeAllConnections()
  await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => clear.close(resolve))])
  await rm(home, { recursive: true, force: true })
}

const diagnostics = await readFile(join(runtime.output, "backend.log"), "utf8")
assert.match(diagnostics, /Host HTTP hooks require HTTPS/)
assert.match(diagnostics, /blocked private or internal address/)
console.log(
  JSON.stringify({
    result: "pass",
    runtime: process.argv[2] ?? "cli",
    scenarios: [
      "trusted HTTPS loopback denial",
      "URL environment expansion",
      "cleartext rejection",
      "private-address rejection",
      "redirect never followed",
    ],
  }),
)
