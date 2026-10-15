import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind, { deferBackend: true, next: () => ({ content: "REPOSITORY_HOOK_DONE" }) })
const directory = join(runtime.directory, "nested")
const home = join(runtime.env.APEXO_TEST_HOME, ".grok")
const trace = join(runtime.output, "repository-hooks.jsonl")
const checks = []
const api = async (endpoint, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
  const url = new URL(endpoint, runtime.url)
  url.searchParams.set("location[directory]", directory)
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${endpoint}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const init = (cwd) => {
  const child = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
}
try {
  await mkdir(directory)
  await mkdir(home, { recursive: true })
  init(runtime.directory)
  await writeFile(join(directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await mkdir(join(runtime.directory, ".grok/hooks"), { recursive: true })
  await writeFile(join(home, "trusted_folders.toml"), `[folders.${JSON.stringify(runtime.directory)}]\ntrusted=true\n`)
  await writeFile(
    join(runtime.output, "observe.py"),
    `import json,sys\nv=json.load(sys.stdin)\nwith open(sys.argv[1],'a') as f: f.write(json.dumps({'session':v['session_id'],'cwd':v['cwd']})+'\\n')\n`,
  )
  await writeFile(
    join(runtime.directory, ".grok/hooks/root.json"),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: `python3 '${join(runtime.output, "observe.py")}' '${trace}'` }] }],
      },
    }),
  )
  await runtime.reopen()
  const rows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
  const create = async () =>
    (
      await api("/api/session", {
        location: { directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
  const prompt = async (session) => {
    await api(`/api/session/${session.id}/prompt`, { prompt: { text: "Complete this repository trust check" } })
    await api(`/api/session/${session.id}/wait`, undefined, "POST", 204)
  }
  const inspect = (session) => api(`/api/session/${session.id}/hooks`)
  const consent = async (session, trusted) => {
    const repository = (await inspect(session)).repository
    assert.equal(repository.root, runtime.directory)
    const before = runtime.calls.length
    const result = await api(`/api/session/${session.id}/hooks/trust`, {
      root: repository.root,
      token: repository.token,
      trusted,
    })
    assert.equal(result.repository.trusted, trusted)
    assert.equal(runtime.calls.length, before, "consent must not execute a provider turn")
    return result
  }
  const first = await create()
  const preview = await inspect(first)
  assert.equal(preview.captured, false)
  assert.equal(preview.repository.trusted, false)
  await prompt(first)
  assert.equal((await rows()).length, 0)
  checks.push("exact-root-legacy-grant-does-not-expand-to-nested-session")
  await api(
    `/api/session/${first.id}/hooks/trust`,
    { root: runtime.directory, token: "0".repeat(64), trusted: true },
    "POST",
    409,
  )
  assert.equal((await inspect(first)).repository.trusted, false)
  checks.push("stale-consent-token-rejected")
  await consent(first, true)
  await prompt(first)
  assert.equal((await rows()).length, 0)
  await api(`/api/session/${first.id}/hooks/reload`, undefined, "POST")
  await prompt(first)
  assert.equal((await rows()).length, 1)
  assert.equal((await rows())[0].cwd, directory)
  checks.push("explicit-root-consent-requires-reload-and-preserves-session-location")
  const second = await create()
  await prompt(second)
  assert.equal((await rows()).length, 2)
  await consent(first, false)
  await prompt(first)
  await prompt(second)
  assert.equal((await rows()).length, 2)
  checks.push("revocation-fences-two-existing-session-snapshots")
  await consent(first, true)
  await prompt(first)
  assert.equal((await rows()).length, 2)
  await api(`/api/session/${first.id}/hooks/reload`, undefined, "POST")
  await prompt(first)
  assert.equal((await rows()).length, 3)
  checks.push("regrant-does-not-revive-old-snapshot-capability")
  init(directory)
  await prompt(first)
  assert.equal((await rows()).length, 3)
  assert.equal((await inspect(first)).repository.root, directory)
  assert.equal((await inspect(first)).repository.trusted, false)
  checks.push("nested-repository-boundary-fences-outer-root-hook")
  await rm(join(directory, ".git"), { recursive: true })
  await runtime.crash()
  await runtime.reopen()
  const fresh = await create()
  assert.equal((await inspect(fresh)).repository.trusted, true)
  await prompt(fresh)
  assert.equal((await rows()).length, 4)
  checks.push("explicit-repository-consent-survives-owned-backend-restart")
  console.log(JSON.stringify({ kind, output: runtime.output, checks, providerCalls: runtime.calls.length }, null, 2))
} finally {
  await runtime.close()
}
