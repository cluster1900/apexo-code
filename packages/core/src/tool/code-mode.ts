export * as CodeModeTool from "./code-mode"

import { CodeMode, Tool, toolError } from "@apexo/codemode"
import { Cause, Effect, Schema } from "effect"
import { McpTools } from "../mcp-tools"
import type { PermissionV2 } from "../permission"
import { Failure, make, type AnyTool, type Content, type Context } from "./tool"

export const NAME = "execute"

const blockedSegments = new Set(["$codemode", "__proto__", "constructor", "prototype"])

interface IndexedEntry {
  readonly namespace: string
  readonly local: string
  readonly entry: McpTools.CatalogEntry
}

function sanitizeSegment(raw: string) {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_")
  if (!cleaned || /^[0-9]/.test(cleaned) || blockedSegments.has(cleaned)) return `_${cleaned}`
  return cleaned
}

function uniqueSegment(base: string, used: Set<string>, index = 1): string {
  const candidate = index === 1 ? base : `${base}_${index}`
  if (used.has(candidate)) return uniqueSegment(base, used, index + 1)
  used.add(candidate)
  return candidate
}

function indexCatalog(entries: ReadonlyArray<McpTools.CatalogEntry>): IndexedEntry[] {
  const ordered = entries.toSorted(
    (a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  )
  const serverNames = new Map<string, string>()
  const usedNamespaces = new Set<string>()
  const usedLocals = new Map<string, Set<string>>()

  return ordered.map((entry) => {
    const namespace = serverNames.get(entry.server) ?? uniqueSegment(sanitizeSegment(entry.server), usedNamespaces)
    serverNames.set(entry.server, namespace)
    const locals = usedLocals.get(namespace) ?? new Set<string>()
    usedLocals.set(namespace, locals)
    return { namespace, local: uniqueSegment(sanitizeSegment(entry.name), locals), entry }
  })
}

function toolTree(
  indexed: ReadonlyArray<IndexedEntry>,
  run: (item: IndexedEntry) => (input: unknown) => Effect.Effect<unknown, unknown>,
) {
  return indexed.reduce<Record<string, Record<string, Tool.Definition>>>((tree, item) => {
    const namespace = (tree[item.namespace] ??= {})
    namespace[item.local] = Tool.make({
      description: item.entry.description,
      input: item.entry.inputSchema as Tool.JsonSchema,
      ...(item.entry.outputSchema !== undefined ? { output: item.entry.outputSchema as Tool.JsonSchema } : {}),
      run: run(item),
    })
    return tree
  }, {})
}

export function describeCatalog(entries: ReadonlyArray<McpTools.CatalogEntry>): string {
  return CodeMode.make({
    tools: toolTree(indexCatalog(entries), () => () => Effect.fail(toolError("Tool preview is not executable."))),
  }).instructions()
}

export function makeTool(deps: {
  readonly toolCatalog: Effect.Effect<ReadonlyArray<McpTools.CatalogEntry>>
  readonly permission: PermissionV2.Interface
}): AnyTool {
  return make({
    description: "Run a confined orchestration script with access to connected MCP tools.",
    input: Schema.Struct({
      code: Schema.String.annotate({ description: "Script body executed by the confined interpreter." }),
    }),
    output: Schema.Unknown,
    toModelOutput: (value) => value.output as ReadonlyArray<Content>,
    execute: (params, context: Context) =>
      Effect.gen(function* () {
        const decide = yield* deps.permission
          .inspect(context.sessionID, context.agent)
          .pipe(Effect.mapError((error) => new Failure({ message: error.message })))
        const visible = (yield* deps.toolCatalog).filter(
          (entry) => entry.mode === "codemode" && decide(entry.key, ["*"]) !== "deny",
        )
        const attachments: Content[] = []
        const counter = { value: 0 }

        const runtime = CodeMode.make({
          tools: toolTree(indexCatalog(visible), (item) => (rawInput: unknown) =>
            Effect.gen(function* () {
              counter.value += 1
              const args =
                rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput)
                  ? (rawInput as Record<string, unknown>)
                  : {}
              const result = yield* item.entry.call(args, {
                ...context,
                toolCallID: `${context.toolCallID}/${counter.value}`,
              })
              const parts = McpTools.toContent(result)
              const files = parts.filter((part) => part.type === "file")
              attachments.push(...files)
              if (result.structuredContent !== undefined && result.structuredContent !== null)
                return result.structuredContent
              const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
              if (text.length > 0) return text.join("\n")
              if (files.length > 0) return `[${files.length} file${files.length === 1 ? "" : "s"} attached to the result]`
              return null
            }).pipe(
              Effect.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
                const error = Cause.squash(cause)
                const message = error instanceof Error ? error.message : String(error)
                return Effect.fail(toolError(message, error))
              }),
            ),
          ),
        })

        const result = yield* runtime.execute(params.code)
        const logs = result.logs ?? []
        const withLogs = (text: string) => {
          if (logs.length === 0) return text
          return text ? `${text}\n\nLogs:\n${logs.join("\n")}` : `Logs:\n${logs.join("\n")}`
        }
        if (!result.ok) {
          const hints = (result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))
          return yield* new Failure({ message: withLogs([result.error.message, ...hints].join("\n")) })
        }
        const rendered =
          typeof result.value === "string"
            ? result.value
            : (JSON.stringify(result.value, null, 2) ?? String(result.value))
        return [{ type: "text" as const, text: withLogs(rendered) }, ...attachments]
      }),
  })
}
