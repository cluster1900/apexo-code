import assert from "node:assert/strict"
import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind, { next: () => ({ content: "PLUGIN_DATA_DONE" }) })
const api = async (endpoint, body, method = body === undefined ? "GET" : "POST") => {
  const url = new URL(endpoint, runtime.url)
  url.searchParams.set("location[directory]", runtime.directory)
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  })
  const text = await response.text()
  assert.ok(response.ok, `${method} ${endpoint}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const checks = []
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const source = join(runtime.output, "persistent-plugin")
  const trace = join(runtime.output, "plugin-data.jsonl")
  await mkdir(join(source, "hooks"), { recursive: true })
  await writeFile(join(source, "plugin.json"), JSON.stringify({ name: "persistent-data" }))
  await writeFile(
    join(source, "observe.py"),
    `import json,os,sys\njson.load(sys.stdin)\np=os.environ['GROK_PLUGIN_DATA']\nassert p==os.environ['CLAUDE_PLUGIN_DATA'] and p!='/forged'\nf=os.path.join(p,'counter')\nn=int(open(f).read())+1 if os.path.exists(f) else 1\nopen(f,'w').write(str(n))\nwith open(sys.argv[1],'a') as out: out.write(json.dumps({'data':p,'count':n})+'\\n')\n`,
  )
  await writeFile(
    join(source, "hooks/hooks.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `python3 "$GROK_PLUGIN_ROOT/observe.py" '${trace}'`,
                env: { GROK_PLUGIN_DATA: "/forged", CLAUDE_PLUGIN_DATA: "/forged" },
              },
            ],
          },
        ],
      },
    }),
  )
  const rows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
  const manage = (action) => api("/api/plugins/manage", action)
  const reload = () => api("/api/plugins/reload", undefined, "POST")
  const prompt = async () => {
    const session = (
      await api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await api(`/api/session/${session.id}/prompt`, { prompt: { text: "Use the installed plugin once" } })
    await api(`/api/session/${session.id}/wait`, undefined, "POST")
  }
  const installed = await manage({ action: "install", source, trust: true })
  const id = installed.items.find((item) => item.name === "persistent-data").id
  await reload()
  await prompt()
  const initial = await rows()
  assert.equal(initial.length, 1)
  assert.equal(initial[0].count, 1)
  checks.push("native-hook-authoritative-data-aliases-and-writable-state")
  const directory = initial[0].data
  await manage({ action: "update", id, trust: true })
  await reload()
  await prompt()
  assert.deepEqual((await rows()).at(-1), { data: directory, count: 2 })
  checks.push("immutable-package-update-retains-data-epoch")
  await manage({ action: "disable", id })
  await reload()
  await prompt()
  assert.equal((await rows()).length, 2)
  await manage({ action: "enable", id })
  await reload()
  await prompt()
  assert.deepEqual((await rows()).at(-1), { data: directory, count: 3 })
  checks.push("disable-stops-hooks-enable-resumes-retained-state")
  await manage({ action: "uninstall", id, keepData: true })
  await reload()
  await access(join(directory, "counter"))
  await manage({ action: "install", source, trust: true })
  await reload()
  await prompt()
  assert.deepEqual((await rows()).at(-1), { data: directory, count: 4 })
  checks.push("keep-data-uninstall-and-reinstall-reuse-exact-epoch")
  const removed = await manage({ action: "uninstall", id })
  assert.deepEqual(removed.retainedData, [{ id, reason: "readers" }])
  assert.equal(await readFile(join(directory, "counter"), "utf8"), "4")
  await reload()
  await manage({ action: "install", source, trust: true })
  await reload()
  await prompt()
  const fresh = (await rows()).at(-1)
  assert.notEqual(fresh.data, directory)
  assert.equal(fresh.count, 1)
  checks.push("default-uninstall-retires-active-data-and-reinstall-uses-new-epoch")

  const pluginRoot = join(fresh.data, "..", "..")
  await writeFile(
    join(pluginRoot, "managed_config.toml"),
    [
      'strict_known_marketplaces = ["https://github.com/xai-org/plugin-marketplace.git"]',
      'disable_plugins = ["persistent-data"]',
      "",
    ].join("\n"),
  )
  const blockedSource = await fetch(
    `${runtime.url}/api/plugins/manage?location[directory]=${encodeURIComponent(runtime.directory)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add-source", source: "https://github.com/evil-org/rogue-marketplace.git" }),
    },
  )
  assert.equal(blockedSource.status, 400)
  await blockedSource.text()
  await reload()
  const countBeforeDisabledPrompt = (await rows()).length
  await prompt()
  assert.equal((await rows()).length, countBeforeDisabledPrompt)
  assert.equal(await readFile(join(fresh.data, "counter"), "utf8"), "1")
  checks.push("organizational-plugin-policy-blocks-unlisted-source-and-disabled-plugin-activation")

  console.log(JSON.stringify({ kind, output: runtime.output, checks, providerCalls: runtime.calls.length }, null, 2))
} finally {
  await runtime.close()
}
