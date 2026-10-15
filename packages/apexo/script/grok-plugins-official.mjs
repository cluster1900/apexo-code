import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const output = await mkdtemp(join(tmpdir(), "apexo-plugins-official-"))
const source = join(output, "catalog")
const plugin = join(source, "plugins", "parity")
const home = join(output, "home")
await mkdir(home)
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
await writeFile(
  join(plugin, "agents", "reviewer.md"),
  "---\nname: reviewer\ndescription: Parity reviewer\n---\nReview carefully",
)
const history = []
const steps = []
const binary = process.env.GROK_BINARY ?? Bun.which("grok")
assert.ok(binary, "Set GROK_BINARY or install grok on PATH for the isolated reference comparison")
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(GROK_|APEXO_|XAI_|OPENCODE_)|(?:API_KEY|TOKEN)$/.test(key)),
  ),
  HOME: home,
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_DATA_HOME: join(home, "data"),
  XDG_CACHE_HOME: join(home, "cache"),
}
const run = async (...args) => {
  const result = await promisify(execFile)(binary, args, {
    env,
    cwd: output,
    timeout: 60_000,
    maxBuffer: 4_000_000,
  })
  history.push({ args, ...result })
  return result.stdout
}
try {
  await run("plugin", "marketplace", "add", source)
  assert.match(await run("plugin", "marketplace", "list"), /catalog/i)
  assert.match(await run("plugin", "list", "--json", "--available"), /parity/)
  steps.push("add-source", "browse-available")
  const untrusted = await run("plugin", "install", plugin).catch((error) => String(error.stderr))
  assert.match(untrusted, /trust/i)
  steps.push("requires-explicit-trust")
  await run("plugin", "install", plugin, "--trust")
  assert.match(await run("plugin", "list", "--json"), /parity/)
  steps.push("install", "list-installed")
  const details = await run("plugin", "details", "parity")
  assert.match(details, /1 skill dir/)
  assert.match(details, /1 command dir.*1 agent dir/)
  steps.push("component-inventory")
  await run("plugin", "disable", "parity")
  await run("plugin", "enable", "parity")
  steps.push("disable", "enable")
  await run("plugin", "uninstall", "parity", "--confirm")
  assert.doesNotMatch(await run("plugin", "list", "--json"), /"name"\s*:\s*"parity"/)
  steps.push("uninstall")
  await run("plugin", "marketplace", "remove", source)
  steps.push("remove-source")
  console.log(JSON.stringify({ passed: steps.length, steps, output }, null, 2))
} finally {
  await writeFile(join(output, "plugins-official.json"), JSON.stringify({ steps, history }, null, 2))
}
