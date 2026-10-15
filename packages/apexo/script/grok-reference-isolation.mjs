// Local comparison harness only; never imported by migrated product features.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { deadline } from "./grok-shell-fixture.mjs"

export async function prepareReferenceIsolation({ output, home, cwd, port, extraEnv = {} }) {
  assert.equal(process.platform, "darwin", "Installed reference requires actual macOS sandbox isolation")
  output = await realpath(output)
  home = await realpath(home)
  cwd = await realpath(cwd)
  const binary = await realpath(
    process.env.GROK_REFERENCE_BINARY ?? process.env.GROK_BIN ?? join(homedir(), ".grok/bin/grok"),
  )
  const base = `http://127.0.0.1:${port}`
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    GROK_HOME: home,
    TMPDIR: join(home, "tmp"),
    LANG: "en_US.UTF-8",
    TERM: "dumb",
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    XAI_API_KEY: "fixture",
    GROK_MANAGED_MCPS_ENABLED: "0",
    GROK_TELEMETRY_ENABLED: "0",
    GROK_TELEMETRY_TRACE_UPLOAD: "0",
    GROK_TELEMETRY_MIXPANEL_ENABLED: "0",
    GROK_XAI_API_BASE_URL: `${base}/v1`,
    GROK_MODELS_LIST_URL: `${base}/v1/models`,
    GROK_CLI_CHAT_PROXY_BASE_URL: `${base}/v1`,
    GROK_CONVERSATIONS_BASE_URL: base,
    GROK_SKILLS_BASE_URL: base,
    ...extraEnv,
  }
  await mkdir(env.TMPDIR, { recursive: true })
  for (const kind of ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"]) {
    const path = join(home, `xdg-${kind.toLowerCase()}`)
    await mkdir(path, { recursive: true })
    env[kind === "RUNTIME" ? "XDG_RUNTIME_DIR" : `XDG_${kind}_HOME`] = path
  }
  for (const vendor of ["CURSOR", "CLAUDE", "CODEX"])
    for (const surface of ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"]) env[`GROK_${vendor}_${surface}_ENABLED`] = "0"
  const actualHome = await realpath(homedir())
  const profile = join(output, "isolation.sb")
  const policy = `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:${port}"))\n(allow network-bind (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-inbound (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(output)})))\n(deny file-read* file-write* (subpath ${JSON.stringify(actualHome)}))\n(allow file-read* (literal ${JSON.stringify(binary)}))\n`
  await writeFile(profile, policy)
  await writeFile(join(output, "isolation.json"), JSON.stringify({ binary, env, policy }, null, 2))
  const run = (args, stdio = ["ignore", "pipe", "pipe"]) =>
    spawn("/usr/bin/sandbox-exec", ["-f", profile, ...args], { cwd, env, detached: true, stdio })
  const guard = async (args) => {
    const child = run(args)
    const stdout = [],
      stderr = []
    child.stdout.on("data", (data) => stdout.push(data))
    child.stderr.on("data", (data) => stderr.push(data))
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    try {
      return {
        code: await deadline(exited, 15000, "reference isolation preflight"),
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
  const denied = await guard(["/bin/ls", actualHome])
  assert.notEqual(denied.code, 0)
  assert.equal(denied.stdout, "")
  assert.match(denied.stderr, /Operation not permitted|Permission denied/)
  const blockedCalls = []
  const blocked = createServer((request, response) => {
    blockedCalls.push(request.url)
    response.end("unexpected")
  })
  try {
    await new Promise((resolve) => blocked.listen(0, "127.0.0.1", resolve))
    assert.notEqual(
      (
        await guard([
          "/usr/bin/curl",
          "--silent",
          "--max-time",
          "2",
          `http://127.0.0.1:${blocked.address().port}/denied`,
        ])
      ).code,
      0,
    )
    assert.equal(blockedCalls.length, 0)
    assert.equal((await guard(["/usr/bin/curl", "--silent", "--max-time", "2", `${base}/v1/models`])).code, 0)
    const version = await guard([binary, "--version"])
    assert.equal(version.code, 0)
    await writeFile(join(output, "version.json"), JSON.stringify(version))
  } finally {
    blocked.closeAllConnections()
    if (blocked.listening) await new Promise((resolve) => blocked.close(resolve))
  }
  return { start: (args) => run([binary, ...args], ["pipe", "pipe", "pipe"]) }
}
