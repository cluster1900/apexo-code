// Real native CLI/Desktop acceptance; imported commands remain Apexo-owned.
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const home = await mkdtemp(join(tmpdir(), "apexo-hook-sources-"))
const trace = join(home, "trace.jsonl")
await writeFile(
  join(home, "observe.py"),
  `import json,os,sys
value=json.load(sys.stdin)
with open(sys.argv[1], 'a') as out: out.write(json.dumps({'session':value['session_id'],'tag':sys.argv[2],'value':os.environ.get('VALUE'),'name':os.environ['GROK_HOOK_NAME'],'pid':os.getpid()})+'\\n')
`,
)
const command = (tag) => `python3 '${join(home, "observe.py")}' '${trace}' '${tag}'`
const group = (tag, value) => ({ hooks: [{ type: "command", command: command(tag), env: { VALUE: value } }] })
const config = (tags, value) =>
  tags
    .map(
      (tag) =>
        `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand=${JSON.stringify(command(tag))}\ntimeout=3\n[hooks.Stop.hooks.env]\nVALUE=${JSON.stringify(value)}\n`,
    )
    .join("\n")
const imports = (enabled) => `[hooks.imports]\nclaude=${enabled}\ncursor=${enabled}\n`
await writeFile(join(home, "requirements.toml"), config(["duplicate", "requirements"], "requirements"))
await writeFile(join(home, "config.toml"), imports(false) + config(["duplicate", "user"], "user"))
await writeFile(join(home, "managed_config.toml"), config(["duplicate"], "managed"))
await mkdir(join(home, "hooks"))
await writeFile(
  join(home, "hooks/file.json"),
  JSON.stringify({ policy: "managed", hooks: { Stop: [group("duplicate", "file"), group("file", "file")] } }),
)
const rows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const runtime = await startShellFixture(kind, { env: { GROK_HOME: home }, next: () => ({ content: "SOURCE_DONE" }) })
const checks = []
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  for (const [root, label] of [
    [runtime.env.APEXO_TEST_HOME, "global"],
    [runtime.directory, "project"],
  ]) {
    for (const [file, tag] of [
      [".claude/settings.json", "claude"],
      [".claude/settings.local.json", "local"],
      [".cursor/hooks.json", "cursor"],
    ]) {
      await mkdir(join(root, file.split("/")[0]), { recursive: true })
      await writeFile(join(root, file), JSON.stringify({ hooks: { Stop: [group(`${label}-${tag}`, label)] } }))
    }
  }
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  const route = `/api/session/${session.id}`
  const prompt = async () => {
    const count = (await rows()).length
    await runtime.api(`${route}/prompt`, { prompt: { text: "Verify hook sources" } })
    await runtime.api(`${route}/wait`, undefined, "POST")
    return (await rows()).slice(count)
  }
  const initial = await prompt()
  assert.deepEqual(
    initial.map((row) => row.tag),
    ["duplicate", "requirements", "user", "file"],
  )
  assert.equal(initial[0].value, "managed")
  assert.equal(initial[0].name, `${home}/managed_config.toml:Stop:0:0`)
  checks.push("additive-layers-authority-dedup-and-default-off-imports")
  const captured = await runtime.api(`${route}/hooks`)
  assert.ok(captured.inspection.hooks.every((hook) => hook.configurable))
  await writeFile(join(home, "config.toml"), imports(true) + config(["duplicate", "user"], "user"))
  await writeFile(join(home, "trusted_folders.toml"), `[folders.${JSON.stringify(runtime.directory)}]\ntrusted=true\n`)
  assert.equal((await prompt()).length, 4)
  const enabled = await runtime.api(`${route}/hooks/reload`, undefined, "POST")
  assert.equal(enabled.inspection.hooks.length, 10)
  const imported = await prompt()
  assert.deepEqual(
    imported.map((row) => row.tag),
    [
      "duplicate",
      "requirements",
      "user",
      "file",
      "global-claude",
      "global-local",
      "global-cursor",
      "project-claude",
      "project-local",
      "project-cursor",
    ],
  )
  checks.push("captured-definitions-and-explicit-reload-of-trusted-global-and-project-imports")
  const managed = enabled.inspection.hooks.find((hook) => hook.name === `${home}/managed_config.toml:Stop:0:0`)
  await runtime.api(`${route}/hooks/preference`, { hookID: managed.id, enabled: false })
  assert.deepEqual(
    (await prompt()).map((row) => row.tag),
    imported.slice(1).map((row) => row.tag),
  )
  checks.push("user-managed-default-remains-disableable")
  await writeFile(join(home, "config.toml"), imports(false) + config(["duplicate", "user"], "user"))
  await writeFile(join(home, "trusted_folders.toml"), "")
  assert.equal((await prompt()).length, 6)
  const revoked = await runtime.api(`${route}/hooks/reload`, undefined, "POST")
  assert.equal(revoked.inspection.hooks.length, 4)
  assert.deepEqual(
    (await prompt()).map((row) => row.tag),
    ["requirements", "user", "file"],
  )
  checks.push("reload-removes-imports-and-keeps-saved-disable-choice")

  const pair = generateKeyPairSync("ed25519")
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString()
  const signedBody = `allow_managed_hooks_only = true\n[signature]\nrequired = true\nfail_closed = true\n${config(["duplicate", "signed-admin"], "signed")}`
  const signature = sign(null, Buffer.from(signedBody, "utf8"), pair.privateKey).toString("base64")
  await writeFile(join(home, "requirements.pub"), publicKey)
  await writeFile(join(home, "requirements.signed.toml"), signedBody)
  await writeFile(join(home, "requirements.signed.toml.sig"), signature)
  const enforced = await runtime.api(`${route}/hooks/reload`, undefined, "POST")
  assert.equal(enforced.inspection.hooks.length, 2)
  assert.ok(enforced.inspection.hooks.every((hook) => hook.readOnlyReason === "managed" && hook.configurable === false))
  const signedHook = enforced.inspection.hooks.find((hook) => hook.source === `${home}/requirements.signed.toml`)
  assert.ok(signedHook)
  const rejectDisable = await fetch(`${runtime.url}${route}/hooks/preference`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hookID: signedHook.id, enabled: false }),
  })
  assert.equal(rejectDisable.status, 400)
  await rejectDisable.text()
  const signedRun = await prompt()
  assert.deepEqual(
    signedRun.map((row) => row.tag),
    ["duplicate", "signed-admin"],
  )
  assert.equal(signedRun[0].value, "signed")
  checks.push("signed-requirements-and-allow-managed-hooks-only-admin-policy")

  for (const row of await rows()) assert.throws(() => process.kill(row.pid, 0))
  const evidence = { kind, checks, providerCalls: runtime.calls.length, rows: await rows(), output: runtime.output }
  await writeFile(join(runtime.output, "hook-sources.json"), JSON.stringify(evidence, null, 2))
  console.log(
    JSON.stringify({
      kind,
      passed: checks.length,
      checks,
      providerCalls: runtime.calls.length,
      output: runtime.output,
    }),
  )
} finally {
  await runtime.close()
}
