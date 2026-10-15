import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const fixture = await startPlanUiFixture()
const { runtime, repo } = fixture
const requests = []
const server = createServer((incoming, response) => {
  response.on("finish", () => requests.push({ path: incoming.url, status: response.statusCode }))
  const url = new URL(incoming.url, "http://localhost")
  const document = incoming.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(
      join(process.env.PLAN_UI_APP_DIST ?? join(repo, "packages/app/dist"), document ? "index.html" : url.pathname),
    )
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
const browserSession = `native-plan-${kind}-${basename(runtime.output)}`
const history = []
const native = { child: undefined, exited: undefined, port: undefined }
const nativeLogs = []
if (kind === "native") {
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
    `const {app}=require('electron');console.log('Plan fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Plan fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
  )
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  native.port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  native.child = spawn(
    join(
      desktop,
      "node_modules/electron/dist",
      (await readFile(join(desktop, "node_modules/electron/path.txt"), "utf8")).trim(),
    ),
    [wrapper, `--remote-debugging-port=${native.port}`],
    {
      cwd: runtime.directory,
      env: { ...runtime.env, SHELL: "/bin/sh", APEXO_PORT: "", APEXO_TEST_ONBOARDING: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  native.exited = new Promise((resolve) => native.child.once("exit", resolve))
  native.child.stdout.on("data", (chunk) => nativeLogs.push(chunk))
  native.child.stderr.on("data", (chunk) => nativeLogs.push(chunk))
}
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      ...(kind === "native"
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
  const prepared = await fixture.prepare()
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${prepared.session.id}`
  if (kind === "native") {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native Plan window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    await command("eval", "window.api.awaitInitialization()")
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    await command(
      "eval",
      `window.api.storeSet("apexo.global.dat","server",JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
    )
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route}`)
  const dock = '[data-component="session-question-dock"]'
  await command("wait", dock)
  if (process.argv.includes("--stop-probe")) {
    await fixture.api(`/api/session/${prepared.session.id}/interrupt`, undefined, "POST")
    assert.deepEqual((await fixture.api(`/api/session/${prepared.session.id}/question`)).data, [])
    await command("wait", "--fn", `document.querySelector('${dock}') === null`)
    assert.ok(
      fixture.events.some(
        (event) => event.type === "question.v2.rejected" && event.data.requestID === prepared.question.id,
      ),
    )
    assert.equal(runtime.calls.length, 3)
    checks.push("active Stop removes the live review through the real rejected event without reload")
  } else {
    assert.equal(prepared.question.questions[0].custom, false)
    assert.equal(
      Number(await command("eval", `document.querySelectorAll('${dock} [data-custom="true"]').length`)),
      0,
      "custom:false must not render a custom answer",
    )
    checks.push("explicit custom:false hides unsupported answer")
    if (!process.argv.includes("--custom-probe")) {
      for (const locale of ["en", "zh", "zht"]) {
        if (kind === "native")
          await command(
            "eval",
            `window.api.storeSet("apexo.global.dat","language",JSON.stringify({locale:${JSON.stringify(locale)}}))`,
          )
        await command(
          "eval",
          `localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:${JSON.stringify(locale)}}))`,
        )
        await command("reload")
        await command("wait", dock)
        const expected =
          locale === "en"
            ? ["Plan approval", "Approve", "Keep planning"]
            : locale === "zh"
              ? ["计划审批", "批准", "继续规划"]
              : ["計畫核准", "核准", "繼續規劃"]
        const text = await command("get", "text", dock)
        for (const label of expected) assert.ok(text.includes(label), `${locale}: ${label}`)
        const displayed = JSON.parse(
          await command("eval", `document.querySelector('${dock} [data-slot="question-text"]').textContent`),
        )
        assert.equal(displayed, prepared.question.questions[0].question)
        const textArea = `${dock} [data-slot="question-text"]`
        await command("eval", `document.querySelector('${textArea}').focus()`)
        await command("press", "End")
        await command(
          "wait",
          "--fn",
          `(()=>{const e=document.querySelector('${textArea}');return e.scrollTop + e.clientHeight >= e.scrollHeight - 2})()`,
        )
        const layout = JSON.parse(
          await command(
            "eval",
            `(()=>{const e=document.querySelector('${textArea}');const s=getComputedStyle(e);return {whiteSpace:s.whiteSpace,wrap:s.overflowWrap,scroll:e.scrollTop,height:e.clientHeight,total:e.scrollHeight,width:e.clientWidth,fullWidth:e.scrollWidth}})()`,
          ),
        )
        assert.equal(layout.whiteSpace, "pre-wrap")
        assert.equal(layout.wrap, "anywhere")
        assert.ok(layout.total > layout.height)
        assert.ok(layout.scroll + layout.height >= layout.total - 2, "keyboard can reach the exact plan end")
        assert.ok(layout.fullWidth <= layout.width + 1, "long path/token wraps without horizontal clipping")
        await command("screenshot", join(runtime.output, `plan-review-bottom-${locale}.png`))
        await command("click", `${dock} [data-slot="question-option"]:nth-child(1)`)
        await command("press", "End")
        await command(
          "wait",
          "--fn",
          `document.activeElement.querySelector('[data-slot="option-label"]')?.textContent === ${JSON.stringify(expected[2])}`,
        )
        assert.equal(
          JSON.parse(
            await command("eval", `document.activeElement.querySelector('[data-slot="option-label"]').textContent`),
          ),
          expected[2],
        )
        await command("press", "ArrowDown")
        assert.equal(
          JSON.parse(
            await command("eval", `document.activeElement.querySelector('[data-slot="option-label"]').textContent`),
          ),
          expected[2],
        )
        await command("press", "Home")
        await command(
          "wait",
          "--fn",
          `document.activeElement.querySelector('[data-slot="option-label"]')?.textContent === ${JSON.stringify(expected[1])}`,
        )
        assert.equal(
          JSON.parse(
            await command("eval", `document.activeElement.querySelector('[data-slot="option-label"]').textContent`),
          ),
          expected[1],
        )
        assert.equal(runtime.calls.length, 3)
        await command("screenshot", join(runtime.output, `plan-review-${locale}.png`))
        checks.push(`${locale}: localized labels preserve exact plan, canonical options and keyboard bounds`)
      }
      await command("press", "Space")
      await command("click", `${dock} button[data-variant="primary"]`)
      await fixture.api(`/api/session/${prepared.session.id}/wait`, undefined, "POST")
      await poll(
        async () => !(await fixture.api(`/api/session/${prepared.session.id}/question`)).data.length,
        "review settled",
      )
      assert.equal((await fixture.api(`/api/session/${prepared.session.id}`)).data.agent, "build")
      assert.equal(runtime.calls.length, 4)
      const logged = (await readFile(fixture.records, "utf8")).trim().split("\n").map(JSON.parse)
      assert.deepEqual(
        JSON.parse(
          logged.find((item) => item.method === "POST" && item.path.endsWith(`/question/${prepared.question.id}/reply`))
            .body,
        ).answers,
        [["Approve"]],
      )
      checks.push("localized approval sends canonical Approve and resumes once")
      const ordinary = await fixture.prepare("ordinary")
      const ordinaryRoute = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${ordinary.session.id}`
      if (kind === "native") {
        await command(
          "eval",
          `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(ordinaryRoute)});return true})()`,
        )
        await command("reload")
      } else await command("open", `${browserUrl}${ordinaryRoute}`)
      await command("wait", dock)
      assert.notEqual(ordinary.question.questions[0].custom, false)
      assert.equal(Number(await command("eval", `document.querySelectorAll('${dock} [data-custom="true"]').length`)), 1)
      await command("click", `${dock} [data-slot="question-option"]:nth-child(1)`)
      await command("press", "End")
      await command("wait", "--fn", `document.activeElement.getAttribute('data-custom') === 'true'`)
      assert.equal(JSON.parse(await command("eval", `document.activeElement.getAttribute('data-custom')`)), "true")
      await command("press", "Home")
      await command(
        "wait",
        "--fn",
        `document.activeElement.querySelector('[data-slot="option-label"]')?.textContent === 'First'`,
      )
      assert.equal(
        JSON.parse(
          await command("eval", `document.activeElement.querySelector('[data-slot="option-label"]').textContent`),
        ),
        "First",
      )
      await command("press", "End")
      await command("wait", "--fn", `document.activeElement.getAttribute('data-custom') === 'true'`)
      await command("press", "Enter")
      await command("wait", `${dock} [data-slot="question-custom-input"]`)
      await command("fill", `${dock} [data-slot="question-custom-input"]`, "CUSTOM_ORDINARY_ANSWER")
      await command("click", `${dock} button[data-variant="primary"]`)
      await fixture.api(`/api/session/${ordinary.session.id}/wait`, undefined, "POST")
      const ordinaryRecords = (await readFile(fixture.records, "utf8")).trim().split("\n").map(JSON.parse)
      assert.deepEqual(
        JSON.parse(
          ordinaryRecords.find(
            (item) => item.method === "POST" && item.path.endsWith(`/question/${ordinary.question.id}/reply`),
          ).body,
        ).answers,
        [["CUSTOM_ORDINARY_ANSWER"]],
      )
      assert.equal(runtime.calls.length, 6)
      checks.push("ordinary absent/default custom answer and keyboard navigation remain available")
    }
  }
  console.log(JSON.stringify({ kind, checks, providerCalls: runtime.calls.length, output: runtime.output }, null, 2))
} catch (error) {
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  await command("snapshot", "-i")
    .then((text) => writeFile(join(runtime.output, "failure.txt"), text))
    .catch(() => {})
  throw error
} finally {
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15000, "owned Plan window cleanup").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(
    join(runtime.output, "plan-ui.json"),
    JSON.stringify({ checks, history, requests, events: fixture.events }, null, 2),
  )
  console.error(`Plan UI evidence: ${runtime.output}`)
}
