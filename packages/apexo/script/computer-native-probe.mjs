import assert from "node:assert/strict"
import { startShellFixture } from "./grok-shell-fixture.mjs"
import { dirname, join, resolve } from "node:path"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const runtime = await startShellFixture("cli", {
  server: "v2",
  deferBackend: true,
  env: { APEXO_COMPUTER_BACKEND: "native", ...(process.env.APEXO_COMPUTER_RUNTIME ? { APEXO_COMPUTER_RUNTIME: process.env.APEXO_COMPUTER_RUNTIME } : {}) },
})
try {
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify({
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers: {
      xai: {
        name: "Native probe",
        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: runtime.env.XAI_BASE_URL, settings: { apiKey: "local-parity-key" } },
        models: { "grok-4.7": { name: "Native probe", api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: runtime.env.XAI_BASE_URL, settings: { apiKey: "local-parity-key" } }, capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 10000 } } },
      },
    },
  }))
  runtime.env.APEXO_CONFIG = join(runtime.directory, "apexo.json")
  await runtime.reopen()
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const passwordProcess = Bun.spawn(["bun", join(repo, "packages/cli/src/index.ts"), "service", "password"], { cwd: join(repo, "packages/cli"), env: runtime.env, stdout: "pipe", stderr: "pipe" })
  const password = (await passwordProcess.stdout.text()).trim()
  assert.equal(await passwordProcess.exited, 0)
  const api = async (endpoint, body, method = body ? "POST" : "GET") => {
    const response = await fetch(`${runtime.url}${endpoint}?directory=${encodeURIComponent(runtime.directory)}`, {
      method,
      headers: { authorization: `Basic ${Buffer.from(`apexo:${password}`).toString("base64")}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    assert.ok(response.ok, `${method} ${endpoint}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const session = (await api("/api/session", { model: { providerID: "xai", id: "grok-4.7" }, location: { directory: runtime.directory } })).data
  const computer = await api(`/api/session/${session.id}/computer`, {})
  assert.ok(["ready", "permission_required", "unavailable"].includes(computer.status))
  assert.equal(computer.backend, process.env.APEXO_COMPUTER_RUNTIME === "lume" ? "lume" : "cua-driver")
  if (computer.status === "permission_required") assert.ok(computer.unavailableReason)
  const observation = computer.status === "ready" ? await api(`/api/session/${session.id}/computer/${computer.id}/action`, { action: "observe" }) : undefined
  if (observation) assert.equal(observation.action, "observe")
  const screenshot = computer.status === "ready" ? await api(`/api/session/${session.id}/computer/${computer.id}/action`, { action: "screenshot" }) : undefined
  if (screenshot) assert.ok(screenshot.artifact?.relativePath)
  const probeAction = process.env.APEXO_COMPUTER_PROBE_ACTION_JSON ? JSON.parse(process.env.APEXO_COMPUTER_PROBE_ACTION_JSON) : undefined
  const action = computer.status === "ready" && probeAction ? await api(`/api/session/${session.id}/computer/${computer.id}/action`, probeAction) : undefined
  if (action) assert.equal(action.action, probeAction.action)
  if (computer.status === "ready") await api(`/api/session/${session.id}/computer/${computer.id}/close`, undefined, "POST")
  console.log(JSON.stringify({ kind: "native-probe", sessionID: session.id, computerSessionID: computer.id, status: computer.status, backend: computer.backend, unavailableReason: computer.unavailableReason ?? null, observed: Boolean(observation), screenshot: screenshot?.artifact?.relativePath ?? null, action: action?.action ?? null, actionOutput: action?.output ?? null }))
} finally {
  await runtime.close()
}
