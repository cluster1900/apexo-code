import { Browser as BrowserSchema } from "@apexo/schema/browser"
import { Browser } from "@apexo/core/browser"
import { AbsolutePath } from "@apexo/core/schema"
import { LocationServiceMap } from "@apexo/core/location-services"
import { Location } from "@apexo/core/location"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
  action: BrowserSchema.Action,
  browserSessionID: Schema.optional(BrowserSchema.BrowserSessionID),
  cdpUrl: Schema.optional(Schema.String),
  pageID: Schema.optional(BrowserSchema.PageID),
  url: Schema.optional(Schema.String),
  selector: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  expectedSnapshotHash: Schema.optional(Schema.String),
  fullPage: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
})

const description =
  "Control an attached Chromium browser through Chrome DevTools Protocol. Open or observe a page before acting, use CSS selectors for clicks and typing, and pass the pageID and expectedSnapshotHash returned by the latest observation."

const isReadOnly = (action: Schema.Schema.Type<typeof BrowserSchema.Action>) =>
  action === "open" || action === "observe" || action === "screenshot"

export const BrowserTool = Tool.define<typeof Parameters, { code?: string }, LocationServiceMap.Service>(
  "browser",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service

    return {
      description,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<{ code?: string }>) =>
        Effect.gen(function* () {
          const resource = params.url ?? params.browserSessionID ?? "browser"
          if (!isReadOnly(params.action))
            yield* ctx.ask({
              permission: "browser_destructive",
              patterns: [resource],
              always: ["*"],
              metadata: params,
            })

          const directory = yield* InstanceState.directory
          const browser = yield* Browser.Service.pipe(
            Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
          )

          if (params.action === "open") {
            if (!params.url)
              return {
                title: "Browser needs a URL",
                output: "browser.open requires url",
                metadata: {},
              }
            const info = yield* browser.open({
              sessionID: ctx.sessionID,
              url: params.url,
              ...(params.cdpUrl ? { cdpUrl: params.cdpUrl } : {}),
            })
            return { title: "Browser opened", output: JSON.stringify(info), metadata: {} }
          }

          if (!params.browserSessionID)
            return {
              title: "Browser needs a session",
              output: `browser.${params.action} requires browserSessionID; call browser.open first`,
              metadata: {},
            }

          const result = yield* browser.act({
            ...params,
            browserSessionID: params.browserSessionID,
          })
          return {
            title: `Browser ${params.action}`,
            output: result.output,
            metadata: {},
            ...(result.artifactData && result.artifact
              ? {
                  attachments: [
                    {
                      type: "file" as const,
                      mime: result.artifact.mime,
                      url: `data:${result.artifact.mime};base64,${result.artifactData}`,
                    },
                  ],
                }
              : {}),
          }
        }).pipe(
          Effect.catchTag("Browser.Error", (error) =>
            Effect.succeed({
              title: "Browser unavailable",
              output: `Browser failed: ${error.message}`,
              metadata: { code: error.code },
            }),
          ),
          Effect.orDie,
        ),
    }
  }),
)
