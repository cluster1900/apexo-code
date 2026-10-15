import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startMediaUiFixture } from "./grok-media-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const background = process.argv.includes("--background")
const fixture = await startMediaUiFixture({ background })
const { runtime, repo } = fixture
const requests = []
const server = createServer((incoming, response) => {
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
const browserSession = `native-media-${kind}-${basename(runtime.output)}`
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
    `const {app}=require('electron');console.log('Media fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Media fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
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
      env: {
        ...runtime.env,
        SHELL: "/bin/sh",
        APEXO_PORT: "",
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("attachment")) {
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
    }, `stable enabled media action ${args[1]}`)
  }
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
const before = runtime.calls.length
const browserUrl = `http://127.0.0.1:${server.address().port}`
const route = (session) =>
  `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${session.id}`
const go = async (session) => {
  await command(
    "eval",
    kind === "native"
      ? `(()=>{const link=document.createElement("a");link.href=${JSON.stringify(route(session))};link.setAttribute("link","");document.body.append(link);link.click();link.remove()})()`
      : `history.pushState({},"",${JSON.stringify(route(session))});dispatchEvent(new PopStateEvent("popstate"))`,
  )
  await command("wait", '[data-timeline-part-id="' + session.toolID + '"]')
}
try {
  if (kind === "native") {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native media window",
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
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route(fixture.sessions[0]))});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route(fixture.sessions[0])}`)
  for (const session of fixture.sessions.slice(0, 2)) {
    await go(session)
    await command(
      "wait",
      "--fn",
      `Array.from(document.querySelectorAll('[data-component="tool-attachments"] img')).some(image=>image.complete&&image.naturalWidth>0)`,
    )
    await command("scrollintoview", '[data-component="tool-attachments"]')
    await command("screenshot", join(runtime.output, `${session.name}.png`))
    checks.push(`${session.name}-decoded-preview`)
  }
  const reads = async () => (await fixture.records()).filter((row) => row.path.startsWith("/api/fs/read/")).length
  for (const locale of process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]) {
    if (locale !== "en") {
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
    }
    for (const session of fixture.sessions.slice(2, 4)) {
      const count = await reads()
      await go(session)
      await command("wait", '[data-component="local-video-attachment"] button')
      assert.equal(await reads(), count)
      const label = locale === "zh" ? "预览视频" : locale === "zht" ? "預覽影片" : "Preview video"
      assert.match(await command("get", "text", '[data-component="local-video-attachment"]'), new RegExp(label))
      await command("scrollintoview", '[data-component="local-video-attachment"]')
      await command("screenshot", join(runtime.output, `${session.name}-${locale}-load.png`))
      await command("click", '[data-component="local-video-attachment"] button')
      await command(
        "wait",
        "--fn",
        `(()=>{const v=document.querySelector('[data-component="local-video-attachment"] video');return v&&v.readyState>=1&&v.videoWidth>0&&v.duration>0})()`,
      )
      assert.equal(await reads(), count + 1)
      const video = JSON.parse(
        await command(
          "eval",
          `(async()=>{const v=document.querySelector('[data-component="local-video-attachment"] video');v.muted=true;const frame=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No rendered media frame: '+JSON.stringify({time:v.currentTime,ready:v.readyState,error:v.error?.message,quality:v.getVideoPlaybackQuality()}))),15000);const next=(_,metadata)=>{if(metadata.mediaTime<2.05||v.currentTime<=2.05){v.requestVideoFrameCallback(next);return}clearTimeout(timeout);resolve({mediaTime:metadata.mediaTime,width:metadata.width,height:metadata.height,presentedFrames:metadata.presentedFrames})};v.requestVideoFrameCallback(next)});v.currentTime=2;await v.play();const rendered=await frame;v.pause();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {src:v.src,width:v.videoWidth,duration:v.duration,currentTime:v.currentTime,rendered}})()`,
        ),
      )
      assert.ok(video.currentTime > 2.05)
      assert.ok(video.rendered.mediaTime >= 2.05 && video.rendered.presentedFrames > 0)
      assert.ok(video.rendered.width > 0 && video.rendered.height > 0)
      await command(
        "eval",
        `(()=>{const v=document.querySelector('[data-component="local-video-attachment"] video');const r=v.getBoundingClientRect();return {beforeReveal:r.toJSON(),frameVisible:[1/3,1/2].every(f=>document.elementFromPoint(r.x+r.width/2,r.y+r.height*f)===v)}})()`,
      )
      // Loading replaces the short action with a tall video and changes scroll anchoring.
      await command("scrollintoview", '[data-component="local-video-attachment"] video')
      await command(
        "wait",
        "--fn",
        `(()=>{const v=document.querySelector('[data-component="local-video-attachment"] video');const r=v.getBoundingClientRect();return [1/3,1/2].every(f=>document.elementFromPoint(r.x+r.width/2,r.y+r.height*f)===v)})()`,
      )
      assert.ok(
        (await command("get", "text", '[data-component="local-video-attachment"] figcaption')).includes(
          session.path.split("/").at(-1),
        ),
      )
      await command("screenshot", join(runtime.output, `${session.name}-${locale}.png`))
      await go(fixture.sessions[0])
      assert.equal(
        (await command("eval", `fetch(${JSON.stringify(video.src)}).then(()=>false,()=>true)`)).trim(),
        "true",
      )
      checks.push(`${session.name}-${locale}-lazy-playable-preview-cleanup`)
      if (locale === "en") {
        await go(session)
        const restored = await reads()
        await command("reload")
        await command("wait", '[data-component="local-video-attachment"] button')
        assert.equal(await reads(), restored)
        assert.equal(
          (
            await command("eval", `document.querySelectorAll('[data-component="local-video-attachment"] video').length`)
          ).trim(),
          "0",
        )
        checks.push(`${session.name}-reload-retains-lazy-saved-output`)
      }
    }
  }
  const missing = fixture.sessions[4]
  await rm(missing.path)
  await go(missing)
  await command("click", '[data-component="local-video-attachment"] button')
  await command("wait", '[data-component="local-video-attachment"] [role="status"]')
  assert.equal(
    (
      await command("eval", `document.querySelectorAll('[data-component="local-video-attachment"] video').length`)
    ).trim(),
    "0",
  )
  await command("screenshot", join(runtime.output, "missing-video.png"))
  checks.push("failed-read-safe-unavailable-without-player")
  assert.equal(runtime.calls.length, before)
  checks.push("preview-navigation-no-provider-wake")
  console.log(JSON.stringify({ kind, checks, providerCalls: runtime.calls.length, output: runtime.output }, null, 2))
} catch (error) {
  await command(
    "eval",
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent?.includes('Error Details'))?.click()`,
  ).catch(() => {})
  await command(
    "eval",
    `JSON.stringify({text:document.body.innerText,details:Array.from(document.querySelectorAll('textarea')).map(item=>item.value)})`,
  )
    .then((value) => writeFile(join(runtime.output, "failure-details.json"), value))
    .catch(() => {})
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  throw error
} finally {
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15000, "media native cleanup").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(join(runtime.output, "media-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Media UI evidence: ${runtime.output}`)
}
