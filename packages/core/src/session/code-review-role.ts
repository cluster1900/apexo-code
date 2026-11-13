export * as SessionCodeReviewRole from "./code-review-role"

import { CodeReview } from "@apexo/schema/code-review"
import { ToolDefinition } from "@apexo/llm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import type { ToolRegistry } from "../tool/registry"
import type { SessionManagedChild } from "./managed-child"
import type { SessionMessage } from "./message"
import type { SessionSchema } from "./schema"
import { CodeReviewCapture } from "./code-review-capture"
import { CodeReviewResult } from "./code-review-result"

export type Role = {
  readonly owner: SessionManagedChild.Record
  readonly inputID: SessionMessage.ID
  readonly captured: CodeReview.Captured
  readonly system: string
  readonly missing: Set<string>
  readonly repairing: () => boolean
  readonly repair: (text: string) => boolean
  readonly take: () => boolean
}
const make = Effect.sync(() => {
  const roles = new Map<SessionSchema.ID, Role>()
  return {
    get: (id: SessionSchema.ID) => roles.get(id),
    attach: (id: SessionSchema.ID, input: Pick<Role, "owner" | "inputID" | "captured" | "system">) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          if (roles.has(id)) throw new Error("Review Session already has an owner")
          const state = { consumed: false, repairing: false }
          const role: Role = {
            ...input,
            missing: new Set(),
            repairing: () => state.repairing,
            repair: (text) => {
              if (state.repairing || Option.isSome(CodeReviewResult.decode(text))) return false
              state.repairing = true
              return true
            },
            take: () => {
              if (state.consumed) return false
              state.consumed = true
              return true
            },
          }
          roles.set(id, role)
          return role
        }),
        (role) =>
          Effect.sync(() => {
            if (roles.get(id) === role) roles.delete(id)
          }),
      ).pipe(Effect.asVoid),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/SessionCodeReviewRole") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [] })

const Diff = Schema.Struct({
  path: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})
const Read = Schema.Struct({
  path: Schema.String,
  side: Schema.Literals(["old", "new"]),
  startLine: Schema.Int.check(Schema.isGreaterThan(0)),
  endLine: Schema.Int.check(Schema.isGreaterThan(0)),
})
export function materialize(role: Role, capture: CodeReviewCapture.Interface): ToolRegistry.Materialization {
  return {
    definitions: role.repairing()
      ? []
      : [
          ToolDefinition.make({
            name: "review_diff",
            description:
              "Read frozen diff patches, optionally for one file; offset paginates characters in 64000-character pages.",
            inputSchema: Schema.toJsonSchemaDocument(Diff).schema,
          }),
          ToolDefinition.make({
            name: "review_read",
            description: "Read at most 200 lines from the captured old/new tree. Never reads the live workspace.",
            inputSchema: Schema.toJsonSchemaDocument(Read).schema,
          }),
        ],
    settle: (input) =>
      Effect.gen(function* () {
        if (role.repairing())
          return { result: { type: "error" as const, value: "Tools are unavailable during output repair" } }
        if (input.call.name === "review_diff") {
          const value = yield* Schema.decodeUnknownEffect(Diff)(input.call.input)
          const files = role.captured.files.filter(
            (file) => !value.path || file.path === value.path || file.oldPath === value.path,
          )
          const text = files.map((file) => file.patch).join("\n")
          return {
            result: {
              type: "text" as const,
              value: JSON.stringify({
                text: text.slice(value.offset ?? 0, (value.offset ?? 0) + 64_000),
                nextOffset: (value.offset ?? 0) + 64_000 < text.length ? (value.offset ?? 0) + 64_000 : null,
              }),
            },
          }
        }
        if (input.call.name === "review_read") {
          const value = yield* Schema.decodeUnknownEffect(Read)(input.call.input)
          if (value.endLine < value.startLine || value.endLine - value.startLine >= 200)
            return { result: { type: "error" as const, value: "Request a positive range of at most 200 lines" } }
          const text = yield* capture.read(role.captured, value.side, value.path).pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                role.missing.add(value.path)
              }),
            ),
          )
          return {
            result: {
              type: "text" as const,
              value: text
                .split("\n")
                .slice(value.startLine - 1, value.endLine)
                .map((line, index) => `${value.startLine + index}: ${line}`)
                .join("\n")
                .slice(0, 64_000),
            },
          }
        }
        return {
          result: { type: "error" as const, value: "Only review_diff and review_read are available to this review" },
        }
      }).pipe(
        Effect.catch(() =>
          Effect.succeed({
            result: {
              type: "error" as const,
              value: "Invalid review request or captured content unavailable; report incomplete coverage",
            },
          }),
        ),
      ),
  }
}
