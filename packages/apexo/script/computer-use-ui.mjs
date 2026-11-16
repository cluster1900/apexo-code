import assert from "node:assert/strict"
import { spawn, execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { Apexo } from "../../client/src/index.ts"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "browser"
const live = process.argv.includes("--live")
assert.ok(["browser", "desktop"].includes(kind))
const fixture = await startComputerUseFixture("cli", { pure: true, live })
const { runtime, state } = fixture
const browserSession = `computer-use-${kind}-${crypto.randomUUID().slice(0, 8)}`
const checks = []
const native = { child: undefined, exited: undefined, port: 0, daemonPID: undefined }
const logs = []
const daemons = () =>
  Bun.spawnSync(["/bin/ps", "-axo", "pid=,command="])
    .stdout.toString()
    .split("\n")
    .filter((line) => /apexo-onboarding-.*apexo-cli serve --register/.test(line))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
const priorDaemons = new Set(daemons())
const proxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (
      request.headers.get("accept")?.includes("text/html") ||
      url.pathname.startsWith("/assets/") ||
      /favicon|apple-touch-icon/.test(url.pathname)
    ) {
      const file = Bun.file(
        resolve(
          "../app/dist",
          request.headers.get("accept")?.includes("text/html") ? "index.html" : url.pathname.slice(1),
        ),
      )
      return new Response(file)
    }
    const target = new URL(url.pathname + url.search, runtime.url)
    return fetch(new Request(target, request))
  },
})
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      ...(kind === "desktop"
        ? ["--cdp", String(native.port)]
        : ["--executable-path", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]),
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  return result.stdout
}
let client = fixture.client
let plugin = fixture.plugin
const sessionState = { id: "" }
try {
  if (kind === "desktop") {
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
    native.port = reservation.port
    await reservation.stop(true)
    native.child = spawn(
      resolve("../desktop/dist/mac-arm64/Apexo Dev.app/Contents/MacOS/Apexo Dev"),
      [`--remote-debugging-port=${native.port}`],
      {
        env: { ...runtime.env, SHELL: "/bin/sh", APEXO_TEST_ONBOARDING: "1", APEXO_SIDECAR_V2: "1", APEXO_PORT: "" },
        cwd: runtime.directory,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    native.exited = new Promise((resolve) => native.child.once("exit", resolve))
    native.child.stdout.on("data", (chunk) => logs.push(chunk))
    native.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "packaged Desktop window",
      45_000,
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const connection = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    const started = daemons().filter((pid) => !priorDaemons.has(pid))
    assert.equal(started.length, 1, "packaged test starts a new isolated native daemon")
    native.daemonPID = started[0]
    client = Apexo.make({
      baseUrl: connection.url,
      headers: connection.password
        ? {
            authorization: `Basic ${Buffer.from(`${connection.username ?? "apexo"}:${connection.password}`).toString("base64")}`,
          }
        : {},
    })
    const health = await client.health.get()
    if (typeof health.pid === "number") {
      const command = Bun.spawnSync(["/bin/ps", "-o", "command=", "-p", String(health.pid)]).stdout.toString()
      assert.match(command, /apexo-onboarding-.*apexo-cli serve/)
      native.daemonPID = health.pid
    }
    await command("eval", "window.api.finishFirstLaunchOnboarding(false)")
    const catalog = await client["server.plugins"].manage({
      action: "add-source",
      source: join(runtime.output, "catalog"),
    })
    plugin = catalog.items.find((item) => item.name === "computer-use")
    checks.push("packaged-desktop-starts-own-backend-and-isolated-data")
    const session = await client.sessions.create({
      location: fixture.location,
      agent: "build",
      model: live
        ? { providerID: "xai", id: "grok-4.7", variant: "low" }
        : { providerID: "computer-fixture", id: "model" },
    })
    sessionState.id = session.id
    const route = `/server/${Buffer.from("sidecar").toString("base64url")}/session/${session.id}`
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  }
  if (kind === "browser") {
    const session = await fixture.session()
    sessionState.id = session.id
    await command(
      "open",
      `${proxy.url.origin}/server/${Buffer.from(proxy.url.origin).toString("base64url")}/session/${session.id}`,
    )
  }
  await command("wait", '[data-component="prompt-input"]')
  checks.push("real-session-ui-renders")
  await command("press", "Meta+,")
  await command(
    "wait",
    "--fn",
    "[...document.querySelectorAll('[role=tab]')].some(node=>node.textContent.trim()==='Plugins')",
  )
  await command("find", "role", "tab", "click", "--name", "Plugins", "--exact")
  await command("wait", '[data-component="plugins-runtime-generation"]')
  await command("fill", ".plugins-filters input", "computer-use")
  await command("click", ".plugins-card")
  const button = async (name) => {
    await command(
      "wait",
      "--fn",
      `[...document.querySelectorAll('.plugins-store button')].some(button=>button.textContent.trim()===${JSON.stringify(name)}&&!button.disabled)`,
    )
    await command(
      "eval",
      `(()=>{const button=[...document.querySelectorAll('.plugins-store button')].find(x=>x.textContent.trim()===${JSON.stringify(name)});if(!button)throw new Error('Missing plugin button');button.scrollIntoView({block:'center'});return true})()`,
    )
    await command("find", "role", "button", "click", "--name", name, "--exact")
  }
  await button("Download")
  await command("wait", ".plugins-readme")
  await button("Install")
  await button("Continue")
  await poll(
    async () =>
      (await client["server.plugins"].list()).items.find((item) => item.id === plugin.id)?.status === "enabled",
    "UI install",
  )
  await command("click", '[data-action="plugins-runtime-reload"]')
  await poll(
    async () =>
      (await command("get", "text", '[data-component="plugins-activation-status"]')).includes("Active in this project"),
    "UI activation",
    45_000,
  )
  assert.equal(
    (await client["server.mcp"].status({ location: fixture.location }))["computer-use:desktop"].status,
    "connected",
  )
  assert.equal(state.requests.length, 0)
  checks.push("ui-download-trust-install-activate-real-bundle-without-provider-work")
  await command("screenshot", join(runtime.output, "computer-use-active.png"))
  await command("press", "Escape")
  if (!live)
    state.steps.push({ tool: toolName("desktop_version"), args: {} }, { content: "COMPUTER_USE_UI_DONE version 1.3.1" })
  await command(
    "fill",
    '[data-component="prompt-input"]',
    live
      ? "Load the computer-use:computer-use Skill, call desktop_version and passive desktop_permissions, then finish with COMPUTER_USE_UI_DONE and the real version. Do not use shell."
      : "Report the Computer Use native version.",
  )
  await command("click", '[data-action="prompt-submit"]')
  await poll(
    async () =>
      (await client.messages.list({ sessionID: sessionState.id, order: "asc" })).data.some(
        (message) =>
          message.type === "assistant" &&
          message.content.some((part) => part.type === "text" && part.text.includes("COMPUTER_USE_UI_DONE")),
      ),
    "actual assistant completion",
    live ? 120_000 : 30_000,
  )
  await poll(
    async () => (await command("get", "text", "body")).includes("COMPUTER_USE_UI_DONE"),
    "UI renders task completion",
    live ? 120_000 : 30_000,
  )
  checks.push("ui-prompt-real-plugin-result-and-rendered-completion")
  await command("screenshot", join(runtime.output, "computer-use-complete.png"))
  if (!live) {
    await client.sessions.wait({ sessionID: sessionState.id })
    assert.equal(Bun.spawnSync(["/usr/bin/open", "-a", "Calculator"]).exitCode, 0)
    const target = await poll(() => {
      const result = Bun.spawnSync([join(fixture.bundle, "bin/agent-desktop"), "list-windows", "--app", "Calculator"], {
        env: { ...process.env, AGENT_DESKTOP_HOME: join(runtime.output, "fixture-setup-state") },
      })
      const envelope = JSON.parse(result.stdout.toString())
      return envelope.ok && envelope.data.find((window) => window.accessible)
    }, "screenshot fixture window")
    state.steps.push(
      { tool: toolName("desktop_screenshot"), args: { app: "Calculator", window_id: target.id } },
      { content: "COMPUTER_USE_IMAGE_DONE" },
    )
    await command("fill", '[data-component="prompt-input"]', "Capture the Calculator fixture window inline.")
    await command("click", '[data-action="prompt-submit"]')
    await client.sessions.wait({ sessionID: sessionState.id })
    await poll(
      async () =>
        state.requests.some((request) =>
          /image_url|input_image/.test(JSON.stringify(request.messages ?? request.input)),
        ),
      "provider receives actual image",
    )
    const imageReady =
      "[...document.querySelectorAll('[data-component=tool-attachments] img')].some(img=>img.complete&&img.naturalWidth>0)"
    if (!JSON.parse(await command("eval", imageReady)))
      await command(
        "find",
        "role",
        "button",
        "click",
        "--name",
        `Called \`${toolName("desktop_screenshot")}\``,
        "--exact",
      )
    await command("wait", "--fn", imageReady)
    checks.push("ui-renders-native-image-and-provider-receives-media")
    await command("screenshot", join(runtime.output, "computer-use-inline-image.png"))
    await client.sessions.switchAgent({ sessionID: sessionState.id, agent: "cancel" })
    const gate = Promise.withResolvers()
    state.hold = gate
    state.steps.push(async () => {
      state.entered = true
      await gate.promise
      return { content: "CANCELED_PROVIDER_RESULT" }
    })
    await command("fill", '[data-component="prompt-input"]', "Wait for the Stop button test.")
    await command("click", '[data-action="prompt-submit"]')
    await poll(() => state.entered, "held provider request")
    await command("find", "role", "button", "click", "--name", "Stop", "--exact")
    await poll(
      async () => !(await client.sessions.active())[sessionState.id],
      "Stop removes active Session ownership",
      15_000,
    )
    gate.resolve()
    checks.push("ui-stop-settles-active-session")
    const confirmed = await client.sessions.create({
      location: fixture.location,
      agent: "confirm",
      model: { providerID: "computer-fixture", id: "model" },
    })
    sessionState.id = confirmed.id
    const route = `/server/${Buffer.from(kind === "desktop" ? "sidecar" : proxy.url.origin).toString("base64url")}/session/${confirmed.id}`
    if (kind === "desktop")
      await command(
        "eval",
        `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
      )
    if (kind === "browser") await command("open", proxy.url.origin + route)
    await command("reload")
    await command("wait", '[data-component="prompt-input"]')
    await client.permissions.setReview({ sessionID: sessionState.id, mode: "manual" })
    for (const reply of ["reject", "once"]) {
      const before = new Set(
        (await client.messages.list({ sessionID: sessionState.id, order: "asc" })).data.map((message) => message.id),
      )
      state.steps.push({ tool: toolName("desktop_permissions"), args: {} })
      await client.sessions.prompt({
        sessionID: sessionState.id,
        id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        prompt: { text: `Check desktop permission with ${reply} approval.` },
      })
      await poll(
        async () => (await client.permissions.list({ sessionID: sessionState.id })).length,
        "manual desktop permission",
      )
      await command("wait", '[data-slot="permission-footer-actions"]')
      await command(
        "click",
        `[data-slot="permission-footer-actions"] button:${reply === "once" ? "last" : "first"}-child`,
      )
      await poll(async () => !(await client.sessions.active())[sessionState.id], "desktop approval settles")
      const messages = (await client.messages.list({ sessionID: sessionState.id, order: "asc" })).data.filter(
        (message) => !before.has(message.id),
      )
      const tool = messages.flatMap((message) =>
        message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
      )[0]
      assert.equal(tool.state.status, reply === "once" ? "completed" : "error")
    }
    checks.push("ui-real-plugin-manual-permission-reject-and-accept")
  }
  console.log(JSON.stringify({ kind, checks, passed: checks.length, output: runtime.output }))
} finally {
  state.hold?.resolve()
  await command("snapshot")
    .then((text) => writeFile(join(runtime.output, "computer-use-final.txt"), text))
    .catch(() => {})
  await command("screenshot", join(runtime.output, "computer-use-final.png")).catch(() => {})
  await command("close").catch(() => {})
  native.child?.kill("SIGTERM")
  if (native.child)
    await deadline(native.exited, 15_000, "owned packaged app exit").catch(() => native.child.kill("SIGKILL"))
  if (native.daemonPID) Bun.spawnSync(["/bin/kill", "-TERM", String(native.daemonPID)])
  await writeFile(join(runtime.output, "computer-use-desktop.log"), Buffer.concat(logs))
  await writeFile(join(runtime.output, "computer-use-ui-result.json"), JSON.stringify({ kind, checks }, null, 2))
  await proxy.stop(true)
  await runtime.close()
}
