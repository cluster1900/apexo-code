import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mediaVideoAttachment } from "../src/utils/media-output"
import { readNativeMedia } from "../src/utils/media-read"
const checks: string[] = []
const check = async (name: string, run: () => Promise<void>) => {
  await run()
  checks.push(name)
}
const file = (path = "/workspace/.grok/sessions/ses_demo/videos/output #1.mp4") => {
  const result = mediaVideoAttachment({
    name: "image_to_video",
    state: { structured: { path, mime: "video/mp4" } },
    id: "tool",
    sessionID: "ses_demo",
    messageID: "msg_demo",
  })
  if (!result) throw new Error("Missing video projection")
  return result
}

await check(
  "native media reads exact Location path with authentication and rejects outside paths before HTTP",
  async () => {
    const requests: { path: string; authorization: string | null }[] = []
    const server = createServer((request, response) => {
      requests.push({ path: `http://127.0.0.1${request.url}`, authorization: request.headers.authorization ?? null })
      response.writeHead(200, { "content-type": "video/mp4" }).end(Buffer.from([1, 2, 3]))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    const origin = `http://127.0.0.1:${address.port}`
    const input = {
      server: { url: origin, username: "fixture", password: "secret" },
      directory: "/workspace",
      signal: new AbortController().signal,
      fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    }
    try {
      const blob = await readNativeMedia({ ...input, file: file() })
      assert.equal(blob.type, "video/mp4")
      assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]))
      const url = new URL(requests[0].path)
      assert.equal(
        decodeURIComponent(url.pathname.slice("/api/fs/read/".length)),
        ".grok/sessions/ses_demo/videos/output #1.mp4",
      )
      assert.equal(url.searchParams.get("location[directory]"), "/workspace")
      assert.equal(requests[0].authorization, `Basic ${btoa("fixture:secret")}`)
      for (const target of [
        file("/workspace-other/file.mp4"),
        { ...file(), url: "file://remote/workspace/file.mp4" },
        { ...file(), url: "file:///workspace/../outside.mp4" },
      ])
        await assert.rejects(readNativeMedia({ ...input, file: target }))
      assert.equal(requests.length, 1)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

for (const mode of ["redirect", "wrong-mime", "oversize", "abort"] as const) {
  await check(`native preview ${mode} refuses unsafe or unfinished output`, async () => {
    const held = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const calls = { target: 0 }
    const server = createServer(async (request, response) => {
      if (request.url === "/target") {
        calls.target++
        response.end("unexpected")
        return
      }
      if (mode === "redirect") {
        response.writeHead(302, { location: "/target" }).end()
        return
      }
      if (mode === "wrong-mime") {
        response.writeHead(200, { "content-type": "text/html" }).end("not video")
        return
      }
      if (mode === "oversize") {
        response
          .writeHead(200, { "content-type": "video/mp4", "content-length": String(100 * 1024 * 1024 + 1) })
          .end("large")
        return
      }
      entered.resolve()
      await held.promise
      response.writeHead(200, { "content-type": "video/mp4" }).end("late")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    const origin = `http://127.0.0.1:${address.port}`
    const abort = new AbortController()
    try {
      const result = readNativeMedia({
        server: { url: origin },
        directory: "/workspace",
        file: file(),
        signal: abort.signal,
        fetch,
      })
      if (mode === "abort") {
        await entered.promise
        abort.abort()
      }
      await assert.rejects(result)
      assert.equal(calls.target, 0)
    } finally {
      held.resolve()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

console.log(JSON.stringify({ checks }))
