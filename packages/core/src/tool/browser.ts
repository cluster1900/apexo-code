export * as BrowserTool from "./browser"

import { Browser as BrowserSchema } from "@apexo/schema/browser"
import { ToolFailure } from "@apexo/llm"
import { Effect, Layer, Schema } from "effect"
import { Browser } from "../browser"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "browser"

export const description = `Control an attached Chromium browser through a durable browser session. Open a page, observe its text and accessibility tree, click or type using CSS selectors, press keys, scroll, and capture screenshots. Observe before acting and pass the returned pageID and expectedSnapshotHash when acting on a page.`

export const Input = Schema.Struct({
  ...BrowserSchema.ActionInput.fields,
  browserSessionID: Schema.optional(BrowserSchema.BrowserSessionID),
  cdpUrl: Schema.optional(Schema.String),
})

const Output = Schema.Struct({
  browserSessionID: BrowserSchema.BrowserSessionID,
  actionID: Schema.optional(BrowserSchema.ActionID),
  action: BrowserSchema.Action,
  output: Schema.String,
  page: Schema.optional(BrowserSchema.Page),
  artifact: Schema.optional(BrowserSchema.Artifact),
  artifactData: Schema.optional(Schema.String),
})

const isReadOnly = (action: BrowserSchema.Action) => action === "observe" || action === "screenshot"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const browser = yield* Browser.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) =>
            output.artifactData
              ? [{ type: "file", data: output.artifactData, mime: output.artifact?.mime ?? "image/png", name: output.artifact?.relativePath }]
              : [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const action = input.action
              const resource = input.url ?? input.browserSessionID ?? "*"
              yield* permission.assert({
                action: isReadOnly(action) ? name : `${name}_destructive`,
                resources: [resource],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              if (action === "open") {
                if (!input.url) return yield* Effect.fail(new ToolFailure({ message: "browser.open requires url" }))
                const info = yield* browser.open({ sessionID: context.sessionID, url: input.url, ...(input.cdpUrl ? { cdpUrl: input.cdpUrl } : {}) })
                return {
                  browserSessionID: info.id,
                  action: "open" as const,
                  output: JSON.stringify(info),
                  ...(info.page ? { page: info.page } : {}),
                }
              }

              if (!input.browserSessionID)
                return yield* Effect.fail(new ToolFailure({ message: `browser.${action} requires browserSessionID` }))
              const result = yield* browser.act(input as Omit<BrowserSchema.ActionInput, "browserSessionID"> & {
                readonly browserSessionID: BrowserSchema.BrowserSessionID
              })
              return {
                browserSessionID: input.browserSessionID,
                actionID: result.actionID,
                action,
                output: result.output,
                ...(result.page ? { page: result.page } : {}),
                ...(result.artifact ? { artifact: result.artifact } : {}),
                ...(result.artifactData ? { artifactData: result.artifactData } : {}),
              }
            }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : new ToolFailure({ message: error.message })))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/browser",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Browser.node],
})
