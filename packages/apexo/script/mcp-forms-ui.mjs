import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startMcpFormsFixture } from "./mcp-forms-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const builtin = kind === "builtin"
const nativeWindow = builtin
const fixture = await startMcpFormsFixture({ mixed: kind === "mixed", desktop: builtin })
const { runtime, repo } = fixture
const requests = []
const refreshHold = join(runtime.output, "unused-hold")
const refreshHeld = join(runtime.output, "ui-list-held")
const releaseRefresh = () =>
  Bun.file(refreshHold)
    .delete()
    .catch(() => {})
const server = createServer(async (incoming, response) => {
  response.on("finish", () => requests.push({ path: incoming.url, status: response.statusCode }))
  const url = new URL(incoming.url, "http://localhost")
  const document = incoming.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    void file.arrayBuffer().then(
      (content) => {
        response.writeHead(200, { "content-type": file.type })
        response.end(Buffer.from(content))
      },
      () => {
        response.writeHead(404)
        response.end()
      },
    )
    return
  }
  const target = new URL(runtime.url)
  if (
    incoming.method === "GET" &&
    url.pathname.endsWith("/review") &&
    existsSync(refreshHold) &&
    !existsSync(refreshHeld)
  ) {
    writeFileSync(refreshHeld, "held")
    while (existsSync(refreshHold)) await Bun.sleep(10)
  }
  const upstream = request(
    {
      hostname: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
      agent: false,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers)
      reply.pipe(response)
      response.on("close", () => reply.destroy())
    },
  )
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502)
    response.end()
  })
  response.on("close", () => upstream.destroy())
  incoming.pipe(upstream)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browserSession = `mcp-forms-${kind}-${basename(runtime.output)}`
const history = []
const native = { child: undefined, exited: undefined, port: undefined }
const nativeLogs = []
if (nativeWindow) {
  const appData = join(runtime.output, "native-app-data")
  await mkdir(join(appData, "com.apexolab.desktop.dev"), { recursive: true })
  await writeFile(
    join(appData, "com.apexolab.desktop.dev/apexo.settings"),
    JSON.stringify({ firstLaunchOnboardingComplete: true }),
  )
  const desktop = join(repo, "packages/desktop")
  const wrapper = join(runtime.output, "native.cjs")
  await writeFile(
    wrapper,
    `const {app,session}=require('electron');const fs=require('node:fs');app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*']},(details,callback)=>{if(details.method==='GET'&&new URL(details.url).pathname.endsWith('/review')&&fs.existsSync(${JSON.stringify(refreshHold)})&&!fs.existsSync(${JSON.stringify(refreshHeld)})){fs.writeFileSync(${JSON.stringify(refreshHeld)},'held');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(refreshHold)}))return;clearInterval(timer);callback({})},10);return}callback({})}));console.log('Task fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Task fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
  )
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  native.port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const sidecarReservation = createServer()
  await new Promise((resolve) => sidecarReservation.listen(0, "127.0.0.1", resolve))
  native.sidecarPort = sidecarReservation.address().port
  await new Promise((resolve) => sidecarReservation.close(resolve))
  native.child = spawn(
    join(
      desktop,
      "node_modules/electron/dist",
      (await readFile(join(desktop, "node_modules/electron/path.txt"), "utf8")).trim(),
    ),
    [wrapper, `--remote-debugging-port=${native.port}`],
    {
      cwd: runtime.directory,
      env: {
        ...runtime.env,
        SHELL: "/bin/sh",
        APEXO_PORT: String(native.sidecarPort),
        APEXO_TEST_ONBOARDING: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  native.exited = new Promise((resolve) => native.child.once("exit", resolve))
  native.child.stdout.on("data", (chunk) => nativeLogs.push(chunk))
  native.child.stderr.on("data", (chunk) => nativeLogs.push(chunk))
}
const command = async (...args) => {
  // agent-browser's click interception guard runs before nested-scroll reveal.
  // Scroll the real form to the action, as a user would, before clicking it.
  if (["click", "check", "select", "fill"].includes(args[0]) && args[1]?.includes("elicitation")) {
    await command("scrollintoview", args[1])
    const layout = { previous: "" }
    await poll(async () => {
      const target = JSON.parse(
        await command(
          "eval",
          `(()=>{const element=document.querySelector(${JSON.stringify(args[1])});if(!element)return {ready:false};const rect=element.getBoundingClientRect();const x=rect.x+rect.width/2;const y=rect.y+rect.height/2;return {rect:rect.toJSON(),ready:!element.disabled&&rect.width>0&&rect.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&element.contains(document.elementFromPoint(x,y))}})()`,
        ),
      )
      const current = JSON.stringify(target.rect)
      const ready = target.ready && current === layout.previous
      layout.previous = current
      return ready
    }, `stable enabled form control ${args[1]}`)
  }
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      ...(nativeWindow
        ? ["--cdp", String(native.port)]
        : [
            "--executable-path",
            process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]),
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}
const checks = []
try {
  if (nativeWindow) {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native form window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const ready = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    if (builtin) {
      runtime.url = ready.url
      runtime.headers = {
        Authorization: `Basic ${Buffer.from(`${ready.username ?? "apexo"}:${ready.password ?? ""}`).toString("base64")}`,
      }
      fixture.session = await fixture.create()
      assert.equal((await runtime.api("/global/health")).healthy, true)
      checks.push("desktop-owned-mixed-backend")
    }
    if (!builtin) await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    if (!builtin)
      await command(
        "eval",
        `window.api.storeSet("apexo.global.dat","server",JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
      )
  }
  if (kind === "mixed") {
    assert.equal((await runtime.api("/global/health")).healthy, true)
    checks.push("default-serve-mixed-backend")
  }
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/server/${Buffer.from(builtin ? "sidecar" : browserUrl).toString("base64url")}/session/${fixture.session.id}`
  if (nativeWindow) {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route}`)
  const dock = '[data-component="session-mcp-elicitation-dock"]'
  const control = (name, suffix = "input") => `${dock} [data-elicitation-field="${name}"] ${suffix}`
  const tools = async (id = fixture.session.id) =>
    (await runtime.api(`/api/session/${id}/message?order=asc`)).data.flatMap((message) =>
      message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
    )
  await command("wait", '[contenteditable="true"]')
  for (const action of ["accept", "decline", "cancel", "interrupt"]) {
    const before = (await tools()).length
    await fixture.prompt(fixture.session.id)
    const pending = await fixture.pending(fixture.session.id)
    await command("wait", dock)
    await command("wait", "--fn", `document.querySelector(${JSON.stringify(control("name"))})?.value === "sample"`)
    assert.equal((await runtime.api(`/api/session/${fixture.session.id}/mcp/elicitation`))[0].id, pending.id)
    checks.push(`${action}-prefilled-without-submission`)
    if (action === "accept") {
      await command("focus", control("name"))
      await command(
        "eval",
        `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true, isComposing:true}))`,
      )
      assert.equal(
        JSON.parse(
          await command(
            "eval",
            `document.activeElement === document.querySelector(${JSON.stringify(control("name"))})`,
          ),
        ),
        true,
      )
      checks.push("ime-enter-keeps-field-focus")
      for (const [from, to] of [
        ["name", "quantity"],
        ["quantity", "ratio"],
        ["ratio", "confirm"],
      ]) {
        await command("focus", control(from))
        await command("press", "Enter")
        await command(
          "wait",
          "--fn",
          `document.activeElement === document.querySelector(${JSON.stringify(control(to))})`,
        )
        assert.equal((await runtime.api(`/api/session/${fixture.session.id}/mcp/elicitation`))[0]?.id, pending.id)
      }
      checks.push("enter-advances-input-without-submitting")
      const order = JSON.parse(
        await command(
          "eval",
          `Array.from(document.querySelectorAll('${dock} [data-elicitation-field]')).filter(field => field.querySelector(':scope > p')).map(field => {const label=field.querySelector(':scope > label').getBoundingClientRect();return {name:field.dataset.elicitationField,belowLabel:Array.from(field.querySelectorAll(':scope > p')).every(hint => hint.getBoundingClientRect().top >= label.bottom)}})`,
        ),
      )
      assert.deepEqual(
        order.map((field) => field.name),
        ["name", "quantity", "ratio", "regions"],
      )
      assert.ok(
        order.every((field) => field.belowLabel),
        JSON.stringify(order),
      )
      checks.push("constraints-follow-field-labels")
      await command("focus", control("name"))
      await command("screenshot", join(runtime.output, "forms-visible.png"))
      await command("fill", control("name"), "")
      await command("click", '[data-action="elicitation-accept"]')
      await command("wait", `${dock} [role="alert"]`)
      assert.equal((await runtime.api(`/api/session/${fixture.session.id}/mcp/elicitation`))[0].id, pending.id)
      checks.push("inline-invalid-reply-keeps-pending")
      await command("reload")
      await command("wait", dock)
      assert.equal((await runtime.api(`/api/session/${fixture.session.id}/mcp/elicitation`))[0].id, pending.id)
      checks.push("reload-hydrates-live-request")
      await command("fill", control("name"), "browser")
      await command("fill", control("quantity"), "3")
      await command("fill", control("ratio"), "0.75")
      await command("check", control("confirm"))
      await command("select", control("environment", "select"), "1")
      await command("check", `${dock} [data-elicitation-field="regions"] [role="group"] label:last-child input`)
      await command("focus", `${dock} [data-elicitation-field="regions"] [role="group"] label:last-child input`)
      await command("press", "Enter")
      await command(
        "wait",
        "--fn",
        `document.activeElement === document.querySelector('[data-action="elicitation-accept"]')`,
      )
      assert.equal((await runtime.api(`/api/session/${fixture.session.id}/mcp/elicitation`))[0]?.id, pending.id)
      checks.push("last-input-enter-focuses-submit")
      await command("press", "Enter")
      checks.push("focused-submit-enter-explicitly-accepts")
    }
    if (action === "decline") await command("click", '[data-action="elicitation-decline"]')
    if (action === "cancel") {
      await command("focus", control("name"))
      await command("press", "Escape")
    }
    if (action === "interrupt") await runtime.api(`/api/session/${fixture.session.id}/interrupt`, undefined, "POST")
    const result = await poll(
      async () => {
        const part = (await tools())[before]
        return part && ["completed", "error"].includes(part.state.status) ? part : undefined
      },
      "tool terminal state",
      20000,
    )
    if (action === "interrupt") assert.equal(result.state.status, "error")
    if (action !== "interrupt") {
      const output = JSON.parse(result.state.content.find((part) => part.type === "text").text)
      assert.equal(output.replies[0].action, action)
      if (action === "accept")
        assert.deepEqual(output.replies[0].content, {
          name: "browser",
          quantity: 3,
          ratio: 0.75,
          confirm: true,
          environment: "prod",
          regions: ["a", "b"],
        })
    }
    await command("wait", "--fn", `!document.querySelector(${JSON.stringify(dock)})`)
    checks.push(`${action}-settles-owned-call`)
  }
  // Session interruption retires the MCP generation; child Tasks capture the live tool catalog at launch.
  await runtime.api("/api/mcp/forms/connect", undefined, "POST")
  checks.push("reconnect-after-interrupt-before-child-launch")
  for (const scenario of ["F04_DIRECT", "F04_NESTED", "F04_SPECIAL", "F04_SPECIAL_EDIT"]) {
    await fixture.prompt(fixture.session.id, undefined, scenario)
    const pending = await fixture.pending(fixture.session.id)
    const special = scenario.includes("SPECIAL")
    if (!special) {
      assert.notEqual(pending.sessionID, fixture.session.id)
      assert.deepEqual(await runtime.api(`/api/session/${fixture.session.id}/mcp/elicitation`), [])
      const owner = (await runtime.api(`/api/session/${pending.sessionID}`)).data
      if (scenario === "F04_DIRECT") assert.equal(owner.parentID, fixture.session.id)
      if (scenario === "F04_NESTED") {
        assert.notEqual(owner.parentID, fixture.session.id)
        assert.equal((await runtime.api(`/api/session/${owner.parentID}`)).data.parentID, fixture.session.id)
      }
    }
    await command("wait", dock)
    if (!special) {
      await command("reload")
      await command("wait", dock)
      assert.equal(
        JSON.parse(await command("eval", `document.querySelector(${JSON.stringify(dock)}).dataset.requestId`)),
        pending.id,
      )
    }
    if (special) {
      assert.equal(
        JSON.parse(await command("eval", `document.querySelector(${JSON.stringify(control("toString"))}).value`)),
        "",
      )
      assert.equal(
        JSON.parse(await command("eval", `document.querySelector(${JSON.stringify(control("valueOf"))}).value`)),
        "",
      )
      if (scenario.endsWith("EDIT")) {
        await command("fill", control("toString"), "2.5")
        await command("fill", control("valueOf"), "chosen")
        await command("select", control("isPrototypeOf", "select"), "0")
      }
    }
    await command("click", '[data-action="elicitation-accept"]')
    const result = await poll(
      async () => {
        const part = (await tools(pending.sessionID)).find((part) => part.id === pending.toolCallID)
        return part?.state.status === "completed" ? part : undefined
      },
      "owned descendant tool completed",
      20000,
    )
    const output = JSON.parse(result.state.content.find((part) => part.type === "text").text)
    assert.equal(output.replies[0].action, "accept")
    assert.deepEqual(
      output.replies[0].content,
      special
        ? {
            hasOwnProperty: false,
            ...(scenario.endsWith("EDIT") ? { toString: 2.5, valueOf: "chosen", isPrototypeOf: "a" } : {}),
          }
        : { name: "sample", quantity: 2, ratio: 0.5, confirm: false, environment: "dev", regions: ["a"] },
    )
    await command("wait", "--fn", `!document.querySelector(${JSON.stringify(dock)})`)
    checks.push(`${scenario}-owned-typed-reply`)
  }
  await command("screenshot", join(runtime.output, "forms-final.png"))
  console.log(JSON.stringify({ kind, checks, output: runtime.output }))
} finally {
  await command("screenshot", join(runtime.output, "forms-final.png")).catch(() => {})
  await command("snapshot", "-i")
    .then((text) => writeFile(join(runtime.output, "forms-final-ui.txt"), text))
    .catch(() => {})
  await writeFile(join(runtime.output, "forms-browser-commands.json"), JSON.stringify(history, null, 2))
  await writeFile(join(runtime.output, "forms-desktop.log"), Buffer.concat(nativeLogs))
  await command("close").catch(() => {})
  native.child?.kill("SIGTERM")
  if (native.exited)
    await deadline(native.exited, 10000, "form Desktop cleanup").catch(() => native.child.kill("SIGKILL"))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  console.error(`Form ${kind} evidence: ${runtime.output}`)
}
