// Isolated native Desktop profile selection and provider-visible tool regression.
// Build Desktop first. Only this fixture's Electron child is closed/relaunched.
import assert from "node:assert/strict"
import { spawn, execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createServer } from "node:net"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const advertised = []
const fixture = await startShellFixture("cli", {
  env: { APEXO_RUNTIME_PROFILE: "apexo" },
  next({ body, text, ancillary }) {
    if (!ancillary) advertised.push({ text, tools: body.tools.map((tool) => tool.function?.name ?? tool.name).sort() })
    return { content: "PROFILE_DONE" }
  },
})
const desktop = join(repo, "packages/desktop")
const executable = join(
  desktop,
  "node_modules/electron/dist",
  (await readFile(join(desktop, "node_modules/electron/path.txt"), "utf8")).trim(),
)
const appData = join(fixture.output, "native-app-data")
await mkdir(join(appData, "com.apexolab.desktop.dev"), { recursive: true })
await writeFile(
  join(appData, "com.apexolab.desktop.dev/apexo.settings"),
  JSON.stringify({ firstLaunchOnboardingComplete: true }),
)
const wrapper = join(fixture.output, "native.cjs")
await writeFile(
  wrapper,
  `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
)
const reservation = createServer()
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const session = `profile-${port}`
const command = async (...args) =>
  (
    await promisify(execFile)("bunx", ["agent-browser", "--session", session, "--cdp", String(port), ...args], {
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout
const native = { child: undefined, exited: undefined }
const logs = []
const launch = async () => {
  native.child = spawn(executable, [wrapper, `--remote-debugging-port=${port}`], {
    cwd: fixture.directory,
    env: { ...fixture.env, SHELL: "/bin/sh", APEXO_PORT: "", APEXO_TEST_ONBOARDING: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  native.exited = new Promise((resolve) => native.child.once("exit", resolve))
  native.child.stdout.on("data", (chunk) => logs.push(chunk))
  native.child.stderr.on("data", (chunk) => logs.push(chunk))
  await poll(
    async () =>
      fetch(`http://127.0.0.1:${port}/json/list`)
        .then((response) => response.json())
        .then((tabs) => tabs.some((tab) => tab.type === "page"))
        .catch(() => false),
    "native window",
  )
  await command("wait", "--fn", "!!window.api?.getRuntimeProfile")
  return JSON.parse(await command("eval", "window.api.getRuntimeProfile()"))
}
const close = async () => {
  if (!native.child || native.child.exitCode !== null) return
  native.child.kill("SIGTERM")
  await deadline(native.exited, 15_000, "owned native window exit").catch(async () => {
    native.child.kill("SIGKILL")
    await native.exited
  })
}
const tools = async (marker, api) => {
  const session = await api("/session", { title: marker })
  await api(`/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: marker }],
  })
  return (await poll(async () => advertised.find((call) => call.text.includes(marker)), marker)).tools
}
const nativeApi = async () => {
  const server = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
  return async (path, body) => {
    const response = await fetch(`${server.url}${path}?directory=${encodeURIComponent(fixture.directory)}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert.ok(response.ok, await response.clone().text())
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }
}
try {
  const cliTools = await tools("PROFILE_CLI_APEXO", fixture.api)
  assert.ok(cliTools.includes("bash"))
  assert.ok(!cliTools.includes("run_terminal_cmd"))
  assert.deepEqual(await launch(), { active: "apexo", preferred: "apexo", supported: true })
  const first = await tools("PROFILE_NATIVE_APEXO", await nativeApi())
  assert.deepEqual(first, cliTools)
  await command("press", "Meta+,")
  await command("wait", '[data-component="settings-runtime-profile"]')
  await command("click", '[data-action="settings-runtime-profile"]')
  await command("find", "role", "option", "click", "--name", "Grok Build")
  await command("wait", '[data-field="runtime-profile-pending"]')
  assert.deepEqual(JSON.parse(await command("eval", "window.api.getRuntimeProfile()")), {
    active: "apexo",
    preferred: "grok-build",
    supported: true,
  })
  assert.match(await command("get", "text", '[data-field="runtime-profile-active"]'), /Apexo/)
  assert.deepEqual(await tools("PROFILE_NATIVE_PENDING", await nativeApi()), first)
  await command("screenshot", join(fixture.output, "pending.png"))
  await close()
  assert.deepEqual(await launch(), { active: "grok-build", preferred: "grok-build", supported: true })
  const selected = await tools("PROFILE_NATIVE_GROK", await nativeApi())
  assert.ok(selected.includes("run_terminal_cmd"))
  assert.ok(!selected.includes("bash"))
  const cli = await new Promise((resolve, reject) => {
    const child = execFile(
      "bun",
      [
        join(repo, "packages/apexo/src/index.ts"),
        "run",
        "--profile",
        "grok-build",
        "--format",
        "streaming-json",
        "--model",
        "xai/grok-4.7",
        "PROFILE_CLI_GROK",
      ],
      { cwd: fixture.directory, env: fixture.env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
    // `run` consumes piped stdin before submitting the prompt; explicitly deliver EOF.
    child.stdin.end()
  })
  const manifest = cli
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((event) => event.type === "available_commands")
  // Noninteractive `run` explicitly denies question and plan-mode permissions.
  const interactive = ["ask_user_question", "enter_plan_mode", "exit_plan_mode"]
  assert.deepEqual(selected.filter((name) => !manifest.tools.includes(name)), interactive)
  assert.deepEqual(manifest.tools.toSorted(), selected.filter((name) => !interactive.includes(name)))
  assert.deepEqual(advertised.find((call) => call.text.includes("PROFILE_CLI_GROK")).tools, manifest.tools.toSorted())
  await command("press", "Meta+,")
  await command("wait", '[data-component="settings-runtime-profile"]')
  assert.match(await command("get", "text", '[data-field="runtime-profile-active"]'), /Grok Build/)
  assert.equal(Number((await command("get", "count", '[data-field="runtime-profile-pending"]')).trim()), 0)
  await command("screenshot", join(fixture.output, "applied.png"))
  await writeFile(join(fixture.output, "result.json"), JSON.stringify({ result: "pass", first, selected }, null, 2))
  console.log(
    JSON.stringify({
      result: "pass",
      output: fixture.output,
      scenarios: [
        "CLI/native Apexo tool equality",
        "native selector persistence",
        "pending profile keeps active tools",
        "owned native relaunch applies Grok tool contract",
      ],
    }),
  )
} finally {
  await close()
  await fixture.close()
  await writeFile(join(fixture.output, "native.log"), Buffer.concat(logs))
}
