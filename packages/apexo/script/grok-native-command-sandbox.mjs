// Actual Apexo CLI/packaged Desktop command-only sandbox acceptance; macOS only.
import assert from "node:assert/strict"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

assert.equal(process.platform, "darwin", "This acceptance requires the macOS Seatbelt backend")
const kind = process.argv[2] ?? "cli"
const requests = []
const nextCall = { tool: "bash", args: { command: "" } }
const runtime = await startShellFixture(kind, {
  config: { snapshot: false },
  next({ finished, ancillary }) {
    if (ancillary) return { content: "Sandbox fixture" }
    requests.push({ finished })
    return finished ? { content: "Command complete" } : { tool: nextCall.tool, args: nextCall.args }
  },
})
const checks = []
const create = (input = {}) =>
  runtime
    .api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
      ...input,
    })
    .then((result) => result.data)
const status = (id) => runtime.api(`/api/session/${id}/sandbox`)
const executeTool = async (id, tool, args) => {
  nextCall.tool = tool
  nextCall.args = args
  await runtime.api(`/api/session/${id}/prompt`, { prompt: { text: `Run this sandbox check: ${tool}` } })
  await runtime.api(`/api/session/${id}/wait`, undefined, "POST")
}
const execute = (id, value) => executeTool(id, "bash", { command: value })
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const off = await create()
  assert.equal((await status(off.id)).profile, "off")
  assert.equal((await status(off.id)).latestExecution, undefined)
  assert.equal(requests.length, 0)
  checks.push("new-root-stores-off-and-passive-status-does-no-provider-work")

  const workspace = await create({ commandSandbox: "workspace" })
  assert.equal((await status(workspace.id)).profile, "workspace")
  assert.equal((await status(workspace.id)).network, "off")
  assert.equal((await status(workspace.id)).latestExecution, undefined)
  assert.equal(requests.length, 0)
  const originalConfig = await readFile(join(runtime.directory, "apexo.json"), "utf8")
  await execute(workspace.id, "printf OK > allowed; printf BAD > ../outside; printf BAD > apexo.json; printf DONE")
  assert.equal(await readFile(join(runtime.directory, "allowed"), "utf8"), "OK")
  assert.equal(await Bun.file(join(runtime.output, "outside")).exists(), false)
  assert.equal(await readFile(join(runtime.directory, "apexo.json"), "utf8"), originalConfig)
  const confirmed = await status(workspace.id)
  assert.equal(confirmed.latestExecution.backend, "seatbelt")
  assert.equal(confirmed.latestExecution.outcome, "exited")
  assert.ok(confirmed.latestExecution.confirmedAt)
  checks.push("workspace-command-enforces-path-boundary-and-records-confirmed-execution")

  const readonly = await create({ commandSandbox: "read-only" })
  await execute(readonly.id, 'printf BAD > readonly-blocked; printf OK > "$TMPDIR/allowed"; printf DONE')
  assert.equal(await Bun.file(join(runtime.directory, "readonly-blocked")).exists(), false)
  assert.equal((await status(readonly.id)).latestExecution.backend, "seatbelt")
  checks.push("read-only-command-denies-workspace-write")

  await mkdir(join(runtime.directory, ".grok"), { recursive: true })
  await writeFile(
    join(runtime.directory, ".grok/sandbox.toml"),
    [
      "[profiles.audit-custom]",
      'extends = "workspace"',
      'deny = ["secrets/**"]',
      "restrict_network = true",
      "",
    ].join("\n"),
  )
  const custom = await create({ commandSandbox: "audit-custom" })
  assert.equal((await status(custom.id)).profile, "audit-custom")
  assert.equal((await status(custom.id)).network, "off")
  await executeTool(custom.id, "write", {
    filePath: join(runtime.directory, "secrets/token.txt"),
    content: "FORBIDDEN",
  })
  assert.equal(await Bun.file(join(runtime.directory, "secrets/token.txt")).exists(), false)
  await executeTool(custom.id, "write", {
    filePath: join(runtime.directory, "custom-allowed.txt"),
    content: "CUSTOM_OK",
  })
  assert.equal(await readFile(join(runtime.directory, "custom-allowed.txt"), "utf8"), "CUSTOM_OK")
  await executeTool(custom.id, "webfetch", {
    url: "http://127.0.0.1:9/blocked",
    format: "text",
  })
  checks.push("custom-profile-and-whole-agent-in-process-write-and-webfetch-enforcement")

  const before = requests.length
  const adopted = await create({ id: workspace.id, location: { directory: "/does-not-exist" } })
  assert.equal(adopted.id, workspace.id)
  const conflict = await fetch(`${runtime.url}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: workspace.id, commandSandbox: "off", location: { directory: runtime.directory } }),
  })
  assert.equal(conflict.status, 409)
  await conflict.text()
  assert.equal((await status(workspace.id)).profile, "workspace")
  assert.equal(requests.length, before)
  checks.push("existing-id-adopts-without-preflight-and-rejects-explicit-downgrade")

  const legacy = await fetch(
    `${runtime.url}/session/${workspace.id}/shell?directory=${encodeURIComponent(runtime.directory)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "build", command: "printf BAD > bypass" }),
    },
  )
  assert.equal(legacy.status, 400)
  await legacy.text()
  assert.equal(await Bun.file(join(runtime.directory, "bypass")).exists(), false)
  assert.equal(requests.length, before)
  checks.push("compatibility-shell-cannot-bypass-confined-policy")

  await runtime.crash()
  await runtime.reopen()
  assert.equal((await status(workspace.id)).profile, "workspace")
  assert.equal((await status(workspace.id)).latestExecution, undefined)
  assert.equal(requests.length, before)
  checks.push("restart-retains-policy-and-resets-process-local-receipt")

  await runtime.api(`/api/session/${workspace.id}`, undefined, "DELETE")
  await create({ id: workspace.id })
  assert.equal((await status(workspace.id)).profile, "off")
  assert.equal((await status(workspace.id)).latestExecution, undefined)
  assert.equal(requests.length, before)
  checks.push("deleted-id-reuse-gets-new-explicit-default-with-no-old-receipt")
  console.log(
    JSON.stringify(
      { kind, checks, passed: checks.length, providerCalls: requests.length, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  await runtime.close()
}
