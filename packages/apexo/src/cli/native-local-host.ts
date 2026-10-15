import { createEmbeddedRoutes, createRoutes } from "@apexo/server/routes"
import { Layer, Logger } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"

/** One private native graph owns all local requests, drains and Location resources. */
export function createNativeLocalHost(password?: string, headless = false) {
  const routes = (password ? createRoutes(password) : createEmbeddedRoutes()).pipe(
    Layer.provide(HttpServer.layerServices),
  )
  const web = HttpRouter.toWebHandler(
    headless
      ? routes.pipe(
          Layer.provide(
            Logger.layer([Logger.make((options) => process.stderr.write(Logger.formatJson.log(options) + "\n"))], {
              mergeWithExisting: false,
            }),
          ),
        )
      : routes,
    { disableLogger: true },
  )
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => web.handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const settlement: { close?: Promise<void> } = {}
  return { fetch, close: () => (settlement.close ??= web.dispose()) }
}
