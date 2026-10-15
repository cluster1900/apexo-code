import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind)
const source = join(runtime.output, "catalog")
const plugin = join(source, "plugins", "parity")
const steps = []
const manage = (action) => runtime.api("/plugins/manage", action)
try {
  await mkdir(join(source, ".grok-plugin"), { recursive: true })
  await mkdir(join(plugin, "skills", "hello"), { recursive: true })
  await mkdir(join(plugin, "commands"), { recursive: true })
  await mkdir(join(plugin, "agents"), { recursive: true })
  await writeFile(
    join(source, ".grok-plugin", "marketplace.json"),
    JSON.stringify({
      name: "Parity",
      plugins: [{ name: "parity", source: "./plugins/parity", description: "Three-client verification" }],
    }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "parity", version: "1.0.0" }))
  await writeFile(
    join(plugin, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Parity skill\n---\nSay PLUGINS_PARITY_OK",
  )
  await writeFile(
    join(plugin, "commands", "hello.md"),
    "---\ndescription: Parity command\n---\nSay PLUGINS_PARITY_COMMAND",
  )
  await writeFile(join(plugin, "agents", "reviewer.md"), "---\ndescription: Parity reviewer\n---\nReview carefully")
  const available = await manage({ action: "add-source", source })
  const id = available.items[0].id
  assert.equal(available.items[0].status, "available")
  assert.equal(
    (await runtime.api("/command")).some((item) => item.name === "parity:hello"),
    false,
  )
  steps.push("browse-without-activation")
  assert.equal((await manage({ action: "download", id })).items[0].status, "downloaded")
  assert.equal(
    (await runtime.api("/command")).some((item) => item.name === "parity:hello"),
    false,
  )
  steps.push("download-without-activation")
  await assert.rejects(() => manage({ action: "install", id }))
  steps.push("requires-explicit-trust")
  const installed = await manage({ action: "install", id, trust: true })
  assert.equal(installed.items[0].status, "enabled")
  await runtime.api("/plugins/reload", undefined, "POST")
  const commands = await runtime.api("/command")
  assert.ok(commands.some((item) => item.name === "parity:hello"))
  const agents = await runtime.api("/agent")
  assert.ok(agents.some((item) => item.name === "parity:reviewer"))
  const config = await runtime.api("/config")
  assert.equal(config.command["parity:hello"].template, "Say PLUGINS_PARITY_COMMAND")
  assert.ok((await runtime.api("/skill")).some((item) => item.name === "parity:hello"))
  steps.push("install-and-project-reload", "command-activation", "agent-activation", "skill-activation")
  const session = await runtime.api("/session", { title: "Plugins reload preserves background work" })
  await runtime.api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "TASK_PANEL_shell" }],
  })
  const [task] = await runtime.api(`/experimental/session/${session.id}/task`)
  assert.equal(task.status, "running")
  const reload = await fetch(`${runtime.url}/plugins/reload?directory=${encodeURIComponent(runtime.directory)}`, {
    method: "POST",
  })
  assert.equal(reload.status, 409)
  await reload.text()
  assert.equal((await runtime.api(`/experimental/session/${session.id}/task/${task.id}`)).status, "running")
  await runtime.api(`/experimental/session/${session.id}/task/${task.id}/cancel`, undefined, "POST")
  await poll(
    async () => (await runtime.api(`/experimental/session/${session.id}/task/${task.id}`)).status === "cancelled",
    "background task cancelled",
  )
  steps.push("reload-preserves-running-background-task")
  await manage({ action: "disable", id })
  await runtime.api("/plugins/reload", undefined, "POST")
  assert.equal(
    (await runtime.api("/command")).some((item) => item.name === "parity:hello"),
    false,
  )
  steps.push("disable-removes-capabilities")
  await manage({ action: "enable", id })
  await runtime.api("/plugins/reload", undefined, "POST")
  assert.ok((await runtime.api("/command")).some((item) => item.name === "parity:hello"))
  steps.push("reenable-restores-capabilities")
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "parity", version: "2.0.0" }))
  assert.equal((await manage({ action: "update", id, trust: true })).items[0].installedVersion, "2.0.0")
  steps.push("update-version")
  if (kind === "cli") {
    const result = await promisify(execFile)("bun", [resolve("src/index.ts"), "plugins", "list", "--json"], {
      env: runtime.env,
      timeout: 30_000,
    })
    assert.ok(JSON.parse(result.stdout).items.some((item) => item.id === id && item.installedVersion === "2.0.0"))
    steps.push("cli-command-shares-registry")
  }
  await manage({ action: "uninstall", id })
  await runtime.api("/plugins/reload", undefined, "POST")
  assert.equal(
    (await runtime.api("/command")).some((item) => item.name === "parity:hello"),
    false,
  )
  assert.equal((await runtime.api("/plugins")).items[0].status, "available")
  steps.push("uninstall-removes-capabilities")
  if (kind === "cli") {
    const result = await promisify(execFile)(
      "bun",
      [resolve("src/index.ts"), "plugins", "list", "--installed", "--json"],
      { env: runtime.env, timeout: 30_000 },
    )
    assert.deepEqual(JSON.parse(result.stdout).items, [])
    steps.push("cli-installed-json-filter")
  }
  await manage({ action: "remove-source", id: available.items[0].sourceID })
  assert.equal((await runtime.api("/plugins")).items.length, 0)
  steps.push("remove-source")
  console.log(JSON.stringify({ kind, passed: steps.length, steps, output: runtime.output }, null, 2))
} finally {
  await writeFile(join(runtime.output, "plugins-parity.json"), JSON.stringify({ steps }, null, 2))
  await runtime.close()
}
