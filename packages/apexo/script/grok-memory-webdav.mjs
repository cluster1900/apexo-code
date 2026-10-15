// macOS-only manual integration fixture. A read-only, loopback WebDAV mount
// exercises the real kernel filesystem type without remote accounts or data.
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { mkdir, realpath } from "node:fs/promises"
import { promisify } from "node:util"

export async function mountWebDAV(directory) {
  if (process.platform !== "darwin") throw new Error("The WebDAV mount fixture requires macOS")
  await mkdir(directory, { recursive: true })
  const target = await realpath(directory)
  const requests = []
  const folders = ["/", "/topics/", "/observations/", "/observations/_inbox/", "/archive/"]
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain PROPFIND bodies before responding. */
    }
    requests.push({ method: request.method, path: request.url })
    if (request.method === "OPTIONS") {
      response.writeHead(200, { DAV: "1", Allow: "OPTIONS, PROPFIND, GET, HEAD", "Content-Length": "0" })
      response.end()
      return
    }
    if (!["GET", "HEAD", "PROPFIND"].includes(request.method)) {
      response.writeHead(405, { "Content-Length": "0" })
      response.end()
      return
    }
    const target = `${new URL(request.url, "http://127.0.0.1").pathname.replace(/\/$/, "")}/`
    if (!folders.includes(target)) {
      response.writeHead(404, { "Content-Length": "0" })
      response.end()
      return
    }
    if (request.method !== "PROPFIND") {
      response.writeHead(200, { "Content-Length": "0" })
      response.end()
      return
    }
    const paths = folders.filter(
      (folder) =>
        folder === target ||
        (request.headers.depth !== "0" &&
          folder.startsWith(target) &&
          !folder.slice(target.length).replace(/\/$/, "").includes("/")),
    )
    const body = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${paths.map((folder) => `<D:response><D:href>${folder}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>${folder}</D:displayname><D:getcontentlength>0</D:getcontentlength><D:getlastmodified>Wed, 14 Oct 2026 00:00:00 GMT</D:getlastmodified><D:creationdate>2026-10-14T00:00:00Z</D:creationdate><D:getetag>"memory-fixture"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join("")}</D:multistatus>`
    response.writeHead(207, {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      DAV: "1",
    })
    response.end(body)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const run = promisify(execFile)
  const closeServer = async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  const unmount = async () => {
    const mounts = await run("/sbin/mount", [], { timeout: 5000 })
    if (mounts.stdout.includes(` on ${target} (`)) await run("/sbin/umount", ["-f", target], { timeout: 15000 })
  }
  await run(
    "/sbin/mount_webdav",
    ["-S", "-o", "rdonly,nobrowse", `http://127.0.0.1:${server.address().port}/`, target],
    { timeout: 30000 },
  ).catch(async (error) => {
    await unmount().finally(closeServer)
    throw error
  })
  return {
    requests,
    async close() {
      await unmount().finally(closeServer)
    },
  }
}
