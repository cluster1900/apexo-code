# Known Issues

## Bun 1.3.14 `node:http` shutdown hang with an unread request body

**Affects:** Bun 1.3.14 (previously pinned in `packageManager`). It is fixed in Bun 1.4.2 and does not occur on Node.

### Symptom

A test that uses `NodeHttpServer` passes all of its assertions. Teardown then hangs for about 20 seconds and fails with:

```
error: All fibers interrupted without error
```

### Root cause

In Bun 1.3.14's `node:http` compatibility layer, a request stays pending forever when both of these hold:

1. the handler never reads the request body, and
2. the handler replies asynchronously, after a macrotask such as `setImmediate`, a timer, or I/O.

`server.close()` then never calls its callback. `closeIdleConnections()` and `closeAllConnections()` do not release the pending request either. A synchronous reply, or one sent from a microtask, is not affected.

`@effect/platform-node`'s `NodeHttpServer` waits up to `gracefulShutdownTimeout` for `server.close()` to finish. The default is 20 seconds, which `NodeHttpServer.layerTest` uses. After that the serve scope closes anyway, in-flight fibers are interrupted, and the test fails with `All fibers interrupted`. The Apexo server sets `gracefulShutdownTimeout: "1 second"`, but its final close step still waits on the same pending request.

In Apexo, this happens when a client sends a body to an endpoint that has no payload and whose handler waits on something. One example is `POST /api/session/:sessionID/interrupt` while a session is running: the handler waits for the runner to stop. On an idle session the interrupt does nothing and replies synchronously, so it does not hang.

### Repro

```ts
import http from "node:http"

const server = http.createServer((req, res) => {
  // The body is never read; the reply is sent after a macrotask.
  setTimeout(() => {
    res.writeHead(204)
    res.end()
  }, 0)
})
server.listen(0, async () => {
  const port = (server.address() as { port: number }).port
  const response = await fetch(`http://127.0.0.1:${port}/x`, { method: "POST", body: "{}" })
  await response.text()
  const timer = setTimeout(() => (console.log("close HUNG"), process.exit(1)), 2000)
  server.close(() => (clearTimeout(timer), console.log("closed")))
})
```

`bun run repro.ts` prints `close HUNG` on Bun 1.3.14. It prints `closed` on Bun 1.4.2 and on Node. It also prints `closed` if the handler reads the body (`req.resume()`) or replies synchronously.

### Why Apexo's clients are not affected

The official clients send endpoints that have no payload as POST requests with no body:

- TUI Esc/interrupt (`session.abort`)
- web app `session.interrupt`
- the generated v2 SDK
- `@apexo/client`, which uses `empty: true`

Only a third-party client, or a manual `curl -d`, that sends a body to such an endpoint can trigger it.

### Guidance

- In tests, send POST requests to endpoints that have no payload without a body, as the real clients do. For example, use `HttpClient.execute(HttpClientRequest.post(url))`, not `HttpClientRequest.bodyJson({})`.
- The project now pins Bun 1.4.4, which includes this upstream fix.
