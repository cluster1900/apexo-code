import { createEmbeddedRoutes, createRoutes } from "@apexo/server/routes"
import { Layer, Logger } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"

/** One private native graph owns all local requests, drains and Location resources. */
export function createNativeLocalHost(password?: string, _headless = false) {
  const routes = (password ? createRoutes(password) : createEmbeddedRoutes()).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(
      Logger.layer(
        process.env.APEXO_PRINT_LOGS === "1"
          ? [Logger.make((options) => process.stderr.write(Logger.formatJson.log(options) + "\n"))]
          : [],
        {
          mergeWithExisting: false,
        },
      ),
    ),
  )
  const web = HttpRouter.toWebHandler(routes, { disableLogger: true })
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => web.handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const settlement: { close?: Promise<void> } = {}
  return { fetch, close: () => (settlement.close ??= web.dispose()) }
}
