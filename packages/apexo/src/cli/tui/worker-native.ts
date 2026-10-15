import "@apexo/core/flag/apexo-env"
import { Rpc } from "@/util/rpc"
import { createNativeLocalHost } from "../native-local-host"

let host: ReturnType<typeof createNativeLocalHost> | undefined
let server: ReturnType<typeof Bun.serve> | undefined

export const rpc = {
  async start() {
    if (host) return { ok: false as const, message: "Native local host already started" }
    const password = crypto.randomUUID() + crypto.randomUUID()
    const owned = createNativeLocalHost(password)
    host = owned
    try {
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: (request) => owned.fetch(request) })
      return {
        ok: true as const,
        url: server.url.origin,
        headers: { Authorization: `Basic ${Buffer.from(`apexo:${password}`).toString("base64")}` },
      }
    } catch {
      await owned.close()
      host = undefined
      return { ok: false as const, message: "Could not start native local host" }
    }
  },
  async shutdown() {
    await server?.stop(true)
    server = undefined
    await host?.close()
    host = undefined
    return { ok: true as const }
  },
}

Rpc.listen(rpc)
