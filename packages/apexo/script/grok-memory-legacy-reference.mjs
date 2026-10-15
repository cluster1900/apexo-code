// Comparison only: installed Grok owns its own isolated ACP Sessions. No Apexo acceptance claim.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"

assert.equal(process.platform, "darwin", "This comparison requires the macOS sandbox egress guard")
const binary = await realpath(process.env.GROK_BIN ?? "/Users/hawk_wu/.grok/bin/grok")
const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-memory-native-reference-")))
// Installed Memory excludes temporary workspaces; this disposable Git root contains no user data.
const workspace = await realpath(await mkdtemp(join(homedir(), ".memory-native-reference-")))
const checks = []
const calls = []
const requests = []
const providerErrors = []
const controls = []
const provider = createServer((request, response) => {
  void respond(request, response).catch((error) => {
    providerErrors.push(String(error))
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
async function respond(request, response) {
  if (request.method !== "POST") {
    response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
    return
  }
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
    assert.ok(chunks.reduce((size, item) => size + item.length, 0) <= 2 * 1024 * 1024, "Bounded fixture request")
  }
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push({ kind: "unexpected", path: request.url })
  requests.push({ path: request.url, body })
  response.writeHead(400, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: { message: "This passive backend probe must not call a model" } }))
}
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${provider.address().port}`
const profile = join(output, "isolation.sb")
await writeFile(
  profile,
  `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:${provider.address().port}"))\n(allow network-bind (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-inbound (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(output)})))\n(deny file-read* file-write* (subpath ${JSON.stringify(await realpath(homedir()))}))\n(allow file-read* (literal ${JSON.stringify(binary)}))\n(allow file-read* file-write* (subpath ${JSON.stringify(workspace)}))\n`,
)
const runChild = async (command, args, options) => {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout = [],
    stderr = []
  child.stdout.on("data", (chunk) => stdout.push(chunk))
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  try {
    return {
      ...(await deadline(exited, 10000, "bounded reference command")),
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGKILL")
      await exited
    }
  }
}

try {
  assert.equal(
    (
      await runChild("/usr/bin/git", ["init", "--quiet"], {
        cwd: workspace,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: output,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      })
    ).code,
    0,
  )
  for (const enabled of [false]) {
    const home = join(output, enabled ? "v2" : "legacy")
    await mkdir(home)
    await mkdir(join(home, "memory"))
    const legacy = "# Memory\n\n## Curated knowledge\nREFERENCE_CARRYOVER_FACT: use immutable request identifiers.\n"
    await writeFile(join(home, "memory", "MEMORY.md"), legacy)
    await writeFile(
      join(home, "config.toml"),
      `[models]\ndefault = "memory-fixture"\n[model.memory-fixture]\nmodel = "fixture"\nname = "Memory reference"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = true\n[memory_v2]\nenabled = ${enabled}\nautomatic_dream_enabled = false\n[cli]\nuse_leader = false\n`,
    )
    await mkdir(join(home, "tmp"))
    const env = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: home,
      GROK_HOME: home,
      TMPDIR: join(home, "tmp"),
      LANG: "en_US.UTF-8",
      TERM: "dumb",
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      GROK_MEMORY: "1",
      GROK_MANAGED_MCPS_ENABLED: "0",
      XAI_API_KEY: "local-fixture",
      GROK_TELEMETRY_ENABLED: "0",
      GROK_TELEMETRY_TRACE_UPLOAD: "0",
      GROK_TELEMETRY_MIXPANEL_ENABLED: "0",
      GROK_XAI_API_BASE_URL: `${url}/v1`,
      GROK_MODELS_LIST_URL: `${url}/v1/models`,
      GROK_CLI_CHAT_PROXY_BASE_URL: `${url}/v1`,
      GROK_CONVERSATIONS_BASE_URL: url,
      GROK_SKILLS_BASE_URL: url,
    }
    for (const kind of ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"]) {
      const path = join(home, `xdg-${kind.toLowerCase()}`)
      await mkdir(path)
      env[kind === "RUNTIME" ? "XDG_RUNTIME_DIR" : `XDG_${kind}_HOME`] = path
    }
    for (const vendor of ["CURSOR", "CLAUDE", "CODEX"])
      for (const surface of ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"])
        env[`GROK_${vendor}_${surface}_ENABLED`] = "0"
    await writeFile(
      join(output, "isolation.json"),
      JSON.stringify(
        {
          binary,
          workspace,
          home,
          environment: env,
          policy: await readFile(profile, "utf8"),
        },
        null,
        2,
      ),
    )
    const guarded = (args) =>
      runChild("/usr/bin/sandbox-exec", ["-f", profile, ...args], {
        cwd: workspace,
        env,
      })
    const deniedDirectory = await mkdtemp(join(homedir(), ".memory-isolation-probe-"))
    const blockedRequests = []
    const blocked = createServer((request, response) => {
      blockedRequests.push(request.url)
      response.end("unexpected")
    })
    try {
      await writeFile(join(deniedDirectory, "sentinel"), "owned-private-isolation-sentinel")
      const denied = await guarded(["/bin/cat", join(deniedDirectory, "sentinel")])
      assert.notEqual(denied.code, 0, "Real home is denied outside owned reference workspace")
      assert.ok(!denied.stdout.includes("owned-private-isolation-sentinel"))
      await writeFile(join(workspace, "isolation.txt"), "owned-workspace-readable")
      assert.equal((await guarded(["/bin/cat", join(workspace, "isolation.txt")])).stdout, "owned-workspace-readable")
      await new Promise((resolve) => blocked.listen(0, "127.0.0.1", resolve))
      const rejected = await guarded([
        "/usr/bin/curl",
        "--silent",
        "--max-time",
        "2",
        `http://127.0.0.1:${blocked.address().port}/blocked`,
      ])
      assert.notEqual(rejected.code, 0, "Non-whitelisted network port is denied")
      assert.equal(blockedRequests.length, 0)
      const allowed = await guarded(["/usr/bin/curl", "--silent", "--max-time", "2", `${url}/v1/models`])
      assert.equal(allowed.code, 0, "Owned provider is reachable")
      const version = await guarded([binary, "--version"])
      assert.equal(version.code, 0)
      controls.push({
        name: "isolation-preflight",
        homeDenied: true,
        workspaceAllowed: true,
        otherPortDenied: true,
        ownedProviderAllowed: true,
        version: version.stdout.trim(),
      })
    } finally {
      blocked.closeAllConnections()
      if (blocked.listening) await new Promise((resolve) => blocked.close(resolve))
      await rm(deniedDirectory, { recursive: true, force: true })
    }
    const child = spawn("/usr/bin/sandbox-exec", ["-f", profile, binary, "agent", "stdio"], {
      cwd: workspace,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    const stderr = []
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    const connection = new ClientSideConnection(
      () => ({
        async sessionUpdate() {},
        async extNotification() {},
        async requestPermission(params) {
          const option = params.options.find((item) => item.kind === "allow_once")
          assert.ok(option)
          return {
            outcome: { outcome: "selected", optionId: option.optionId },
          }
        },
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
    )
    try {
      await deadline(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "apexo-memory-comparison", version: "1" },
        }),
        15000,
        "official initialization",
      )
      const session = await deadline(
        connection.newSession({ cwd: workspace, mcpServers: [] }),
        15000,
        "official Session",
      )
      const method = (name, args) =>
        deadline(connection.extMethod(`_x.ai/memory/${name}`, args), 30000, `official ${name}`)
      const listing = await method("list", { sessionId: session.sessionId })
      assert.equal(calls.length, 0)
      checks.push({ name: "requested-legacy-effective-backend-probe", listing, providerCalls: calls.length })
      const v2 = listing.files.some((file) => file.path.includes("/topics/") || file.path.includes("/observations/"))
      checks.push({
        name: "backend-evidence",
        requested: "legacy",
        observed: v2 ? "v2-artifacts" : "legacy-candidate",
        definitiveLegacy: false,
      })
      // Do not run or label legacy acceptance unless its effective backend can be proved.
      assert.equal(calls.length, 0)
    } finally {
      if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGTERM")
      await deadline(exited, 10000, "official joined shutdown").catch(async () => {
        process.kill(-child.pid, "SIGKILL")
        await exited
      })
      await writeFile(join(output, "official-stderr.log"), Buffer.concat(stderr))
    }
  }
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify({ checks, calls, requests, providerErrors, controls }, null, 2),
  )
  console.log(
    JSON.stringify(
      {
        result: "backend-probe-only",
        comparisonOnly: true,
        checks,
        providerCalls: calls.length,
        classifiedCalls: Object.fromEntries(
          ["main", "capture", "dream", "title", "dashboard"].map((kind) => [
            kind,
            calls.filter((item) => item.kind === kind).length,
          ]),
        ),
        controls,
        output,
      },
      null,
      2,
    ),
  )
} finally {
  await writeFile(
    join(output, "observed.json"),
    JSON.stringify({ checks, calls, requests, providerErrors, controls }, null, 2),
  )
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await rm(workspace, { recursive: true, force: true })
  console.error(`Memory reference evidence: ${output}`)
}
