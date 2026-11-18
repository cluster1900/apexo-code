import { FSUtil } from "@apexo/core/fs-util"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"

let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(
    /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])apexo-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
  )
}

export function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-expect-error - generated file at build time
    import("apexo-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null))
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function embeddedUIResponse(file: string, body: Uint8Array) {
  const mime = FSUtil.mimeType(file)
  const headers = new Headers({ "content-type": mime })
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
  }
  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
) {
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  return fs.readFile(file).pipe(
    Effect.map((body) => embeddedUIResponse(file, body)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

// Without an embedded web UI (dev builds or --disable-embedded-web-ui) the server no longer proxies a
// hosted app; it serves a short notice instead. Build with `bun run build --single` to embed the UI.
const UI_MISSING_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Apexo</title></head>
  <body>
    <h1>Apexo</h1>
    <p>The web UI is not embedded in this build. Rebuild with <code>bun run build --single</code>, or run the app dev server from <code>packages/app</code>.</p>
  </body>
</html>
`

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: FSUtil.Interface; disableEmbeddedWebUi: boolean },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI(services.disableEmbeddedWebUi))
    const path = new URL(request.url, "http://localhost").pathname

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI)
    if (path !== "/" && path !== "/index.html") return notFound()
    return HttpServerResponse.text(UI_MISSING_HTML, {
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "content-security-policy": DEFAULT_CSP },
    })
  })
}
