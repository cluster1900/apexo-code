// Actual Electron window, preload and sidecar with isolated settings.
import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
const { runtime, control } = await startGoalFixture("cli")
const repo = resolve("../..")
const history = [],
  checks = [],
  logs = []
let child, port
const name = `goal-native-${Date.now()}`
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    ["agent-browser", "--session", name, "--cdp", String(port), ...args],
    { timeout: 45000, maxBuffer: 4000000 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}
const button = (name) => command("find", "role", "button", "click", "--name", name, "--exact")
const click = async (selector) => {
  await command("scrollintoview", selector)
  const layout = { previous: "" }
  await poll(async () => {
    const hit = JSON.parse(
      await command(
        "eval",
        `(() => {
      const element=document.querySelector(${JSON.stringify(selector)});
      const rect=element?.getBoundingClientRect();
      return { rect:rect?.toJSON(), hit:!!rect && rect.width>0 && rect.height>0 && rect.x+rect.width/2>=0 && rect.x+rect.width/2<innerWidth && rect.y+rect.height/2>=0 && rect.y+rect.height/2<innerHeight && element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)) };
    })()`,
      ),
    )
    const current = JSON.stringify(hit.rect)
    const stable = hit.hit && current === layout.previous
    layout.previous = current
    return stable
  }, `visible, stable native target: ${selector}`)
  await command(
    "eval",
    `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const trace = { selector: ${JSON.stringify(selector)}, before: element?.getBoundingClientRect().toJSON(), events: [] };
    document.documentElement.dataset.goalClickTrace = JSON.stringify(trace);
    for (const type of ['pointerdown','mousedown','click']) document.addEventListener(type, event => {
      trace.events.push({ type, x:event.clientX, y:event.clientY, correct: element?.contains(event.target), target:event.target.outerHTML.slice(0,350), rect:element?.getBoundingClientRect().toJSON() });
      document.documentElement.dataset.goalClickTrace = JSON.stringify(trace);
    }, {capture:true, once:true});
  })()`,
  )
  await command("click", selector)
  const trace = JSON.parse(JSON.parse(await command("eval", "document.documentElement.dataset.goalClickTrace")))
  await writeFile(join(runtime.output, `goal-native-click-${history.length}.json`), JSON.stringify(trace, null, 2))
  assert.ok(
    trace.events.some((event) => event.type === "click" && event.correct),
    `native click missed ${selector}`,
  )
}
const inspect = async (label) => {
  await command("screenshot", join(runtime.output, `goal-native-${label}.png`))
  await writeFile(
    join(runtime.output, `goal-native-${label}-layout.json`),
    await command(
      "eval",
      `Array.from(document.querySelectorAll('[data-slot="dialog-container"], [data-slot="dialog-content"], [data-slot="dialog-body"], [data-component="session-goal"], [data-action="goal-clear"], [data-action="goal-reports-delete-confirm"]')).map(element => {const rect=element.getBoundingClientRect();return {slot: element.dataset.slot, action: element.dataset.action, rect:rect.toJSON(), scrollHeight:element.scrollHeight, clientHeight:element.clientHeight, scrollTop:element.scrollTop, overflow:getComputedStyle(element).overflowY,hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,350)}})`,
    ),
  )
}
try {
  const documents = join(runtime.output, "documents")
  await mkdir(documents)
  const bootstrap = join(runtime.output, "native-bootstrap.mjs")
  await writeFile(
    bootstrap,
    `import { app } from "electron"; app.setPath("documents", ${JSON.stringify(documents)}); await import(${JSON.stringify(pathToFileURL(join(repo, "packages/desktop/out/main/index.js")).href)});`,
  )
  const executable = join(
    repo,
    "packages/desktop/node_modules/electron/dist",
    (await readFile(join(repo, "packages/desktop/node_modules/electron/path.txt"), "utf8")).trim(),
  )
  child = Bun.spawn([executable, "--remote-debugging-port=0", bootstrap], {
    env: {
      ...runtime.env,
      HOME: runtime.env.APEXO_TEST_HOME,
      APEXO_TEST_ONBOARDING: "1",
      APEXO_SIDECAR_V2: "0",
      ELECTRON_RUN_AS_NODE: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const collect = async (stream) => {
    for await (const bytes of stream) {
      const text = new TextDecoder().decode(bytes)
      logs.push(text)
      const match = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)
      if (match) port = Number(match[1])
    }
  }
  void Promise.all([collect(child.stdout), collect(child.stderr)])
  await poll(() => port, "native debug endpoint", 30000)
  await poll(
    async () =>
      (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).some(
        (t) => t.type === "page" && t.url.includes("index.html"),
      ),
    "native window",
    30000,
  )
  await command("wait", "body")
  const seed = JSON.parse(
    await command(
      "eval",
      `window.api.awaitInitialization().then(async server => {
    const dir = ${JSON.stringify(runtime.directory)};
    const response = await fetch(server.url+'/session?directory='+encodeURIComponent(dir), {method:'POST', headers:{'content-type':'application/json', authorization:'Basic '+btoa(server.username+':'+server.password)}, body:JSON.stringify({title:'Native Goal',agent:'build',model:{providerID:'xai',id:'grok-4.7'}})});
    if(!response.ok) throw new Error(await response.text());
    const session = await response.json();
    localStorage.setItem('apexo.desktop.window.'+await window.api.getWindowID()+'.last-active-url','/'+btoa(dir).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')+'/session/'+session.id);
    return { id:session.id };
  })`,
    ),
  )
  await command("reload")
  await command("wait", '[data-action="session-goal"]')
  await click('[data-action="session-goal"]')
  await command("wait", '[data-field="goal-objective"]')
  assert.equal(control.calls.length, 0)
  await command("fill", '[data-field="goal-objective"]', "NATIVE_GOAL verify all requirements")
  await command("fill", '[data-field="goal-budget"]', "10000")
  control.hold = Promise.withResolvers()
  await click('[data-action="goal-create"]')
  await poll(() => control.calls.some((call) => call.phase === "executing"), "native worker running")
  const text = () => command("get", "text", '[data-component="session-goal"]')
  await poll(async () => (await text()).includes("Active"), "native goal active")
  checks.push("native-window-empty-session-start")
  await command("press", "Escape")
  await click('[data-action="session-goal"]')
  await click('[data-action="goal-pause"]')
  await poll(async () => (await text()).includes("Paused by you"), "native paused")
  control.hold.resolve()
  control.hold = undefined
  await click('[data-action="goal-resume"]')
  await poll(async () => (await text()).includes("Verified complete"), "native complete")
  checks.push("native-reopen-pause-resume-and-verification")
  await command("press", "Escape")
  await command("eval", 'localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:"zh"}))')
  await command("reload")
  await command("wait", '[data-action="session-goal"]')
  await click('[data-action="session-goal"]')
  await poll(async () => (await text()).includes("已验证完成"), "native Chinese status")
  assert.match(await command("get", "text", '[data-component="goal-verification"]'), /3\/3/)
  if (!process.argv.includes("--report-diagnostic")) {
    await click('[data-verifier="2"] summary')
    await command("wait", "2500")
    assert.equal(await command("get", "count", '[data-verifier="2"][open]').then(Number), 1)
    checks.push("native-three-verifier-reports")
  }
  await command("screenshot", join(runtime.output, "goal-native-zh.png"))
  checks.push("native-localized-status-and-evidence")
  await click('[data-action="goal-reports-open"]')
  await command("wait", "[data-report-id]")
  const reportID = JSON.parse(await command("eval", 'document.querySelector("[data-report-id]").dataset.reportId'))
  await click(`[data-report-id="${reportID}"] summary`)
  await click(`[data-report-id="${reportID}"] [data-report-file="objective"]`)
  await poll(
    async () => (await command("get", "text", '[data-component="goal-report-preview"]')).includes("NATIVE_GOAL"),
    "native report preview",
  )
  await poll(
    async () =>
      JSON.parse(
        await command(
          "eval",
          `(() => {
    const heading=document.querySelector('[data-component="goal-report-preview"] h4');
    const rect=heading.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    return {visible:rect.y>=0 && rect.bottom<=innerHeight && heading.contains(hit),rect:rect.toJSON(),hit:hit?.outerHTML.slice(0,600),viewport:{width:innerWidth,height:innerHeight},scroll:document.querySelector('[data-component="session-goal"]')?.scrollTop};
  })()`,
        ),
      ).visible,
    "viewing a report must bring its preview into view",
  )
  const download = join(runtime.output, "native-downloaded-objective.txt")
  await command("screenshot", join(runtime.output, "goal-native-report-preview.png"))
  await command("scrollintoview", `[data-report-id="${reportID}"] [data-report-download="objective"]`)
  await command("download", `[data-report-id="${reportID}"] [data-report-download="objective"]`, download)
  assert.match(await readFile(download, "utf8"), /NATIVE_GOAL verify all requirements/)
  checks.push("native-localized-report-preview-and-real-download")
  await click('[data-action="goal-reports-delete"]')
  await inspect("before-report-delete")
  await click('[data-action="goal-reports-delete-confirm"]')
  await inspect("after-report-delete")
  await poll(async () => (await text()).includes("暂无可用的报告文件"), "native reports cleaned")
  checks.push("native-report-cleanup-preserves-completed-goal")
  await command("screenshot", join(runtime.output, "goal-native-before-clear.png"))
  await writeFile(
    join(runtime.output, "goal-native-before-clear-layout.json"),
    await command(
      "eval",
      `Array.from(document.querySelectorAll('[data-slot="dialog-container"], [data-slot="dialog-content"], [data-slot="dialog-body"], [data-component="session-goal"], [data-action="goal-clear"]')).map(element => ({slot: element.dataset.slot, action: element.dataset.action, rect: element.getBoundingClientRect().toJSON(), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflow: getComputedStyle(element).overflowY}))`,
    ),
  )
  await click('[data-action="goal-clear"]')
  await command("wait", '[data-action="goal-clear-confirm"]')
  await command("scrollintoview", '[data-action="goal-clear-confirm"]')
  await command("wait", "2500")
  await command("screenshot", join(runtime.output, "goal-native-clear.png"))
  await click('[data-action="goal-clear-confirm"]')
  await command("wait", '[data-field="goal-objective"]')
  checks.push("native-clear-confirmation")
  console.log(
    JSON.stringify(
      {
        mode: process.argv.includes("--report-diagnostic") ? "report-diagnostic" : "full",
        checks,
        sessionID: seed.id,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(await command("snapshot", "-i").catch(String))
  await writeFile(
    join(runtime.output, "goal-native-layout.json"),
    await command(
      "eval",
      `Array.from(document.querySelectorAll('[data-slot="dialog-container"], [data-slot="dialog-content"], [data-slot="dialog-body"], [data-component="session-goal"], [data-action="goal-clear-confirm"]')).map(element => {
        const css = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, classes: element.className, slot: element.dataset.slot, component: element.dataset.component, action: element.dataset.action, rect: rect.toJSON(), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop, display: css.display, height: css.height, minHeight: css.minHeight, flex: css.flex, overflow: css.overflow, hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 500) };
      })`,
    ).catch(String),
  )
  await command("screenshot", join(runtime.output, "goal-native-failure.png")).catch(() => {})
  throw error
} finally {
  control.hold?.resolve()
  await command("close").catch(() => {})
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "native Goal cleanup").catch(() => child.kill("SIGKILL"))
  await writeFile(
    join(runtime.output, "goal-native.json"),
    JSON.stringify({ checks, history, calls: control.calls }, null, 2),
  )
  await writeFile(join(runtime.output, "goal-native.log"), logs.join(""))
  await runtime.close()
  console.error(`Native Goal evidence: ${runtime.output}`)
}
