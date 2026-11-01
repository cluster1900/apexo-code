import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Tool } from "@apexo/core/tool/tool"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { JsonSchema, Option, Schema } from "effect"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))

export type ValidationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string }

export interface LoadedOutputSchema {
  readonly rawText: string
  readonly schema: Record<string, unknown>
  readonly validate: (value: unknown) => ValidationResult
}

export interface ParsedRunGuardrails {
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly maxBudgetUsd?: number
  readonly fallbackModel?: Model.Ref
}

export function hasRunGuardrailFlags(input: {
  readonly "max-turns"?: number
  readonly "max-tokens"?: number
  readonly "max-budget-usd"?: number
  readonly "fallback-model"?: string
}) {
  return (
    input["max-turns"] !== undefined ||
    input["max-tokens"] !== undefined ||
    input["max-budget-usd"] !== undefined ||
    input["fallback-model"] !== undefined
  )
}

export function parseRunGuardrails(input: {
  readonly interactive?: boolean
  readonly command?: string
  readonly model?: string
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly maxBudgetUsd?: number
  readonly fallbackModel?: string
}): ParsedRunGuardrails {
  if (input.interactive) {
    if (input.maxTurns !== undefined) throw new Error("--max-turns cannot be used in interactive mode")
    if (input.maxTokens !== undefined) throw new Error("--max-tokens cannot be used in interactive mode")
    if (input.maxBudgetUsd !== undefined) throw new Error("--max-budget-usd cannot be used in interactive mode")
    if (input.fallbackModel !== undefined) throw new Error("--fallback-model cannot be used in interactive mode")
  }
  const hasAny =
    input.maxTurns !== undefined ||
    input.maxTokens !== undefined ||
    input.maxBudgetUsd !== undefined ||
    input.fallbackModel !== undefined
  if (hasAny && input.command !== undefined) {
    throw new Error(
      "Execution guardrails (--max-turns, --max-tokens, --max-budget-usd, --fallback-model) cannot be used with --command",
    )
  }
  if (input.maxTurns !== undefined && (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1)) {
    throw new Error("--max-turns must be a positive integer")
  }
  if (input.maxTokens !== undefined && (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1)) {
    throw new Error("--max-tokens must be a positive integer")
  }
  if (
    input.maxBudgetUsd !== undefined &&
    (typeof input.maxBudgetUsd !== "number" || !Number.isFinite(input.maxBudgetUsd) || input.maxBudgetUsd <= 0)
  ) {
    throw new Error("--max-budget-usd must be a positive number")
  }
  const fallbackModel = (() => {
    if (input.fallbackModel === undefined) return undefined
    const trimmed = input.fallbackModel.trim()
    const slash = trimmed.indexOf("/")
    if (slash <= 0 || slash === trimmed.length - 1) {
      throw new Error("--fallback-model must use provider/model syntax")
    }
    if (input.model !== undefined && trimmed === input.model.trim()) {
      throw new Error("--fallback-model must differ from --model")
    }
    return Model.Ref.make({
      providerID: Provider.ID.make(trimmed.slice(0, slash)),
      id: Model.ID.make(trimmed.slice(slash + 1)),
    })
  })()
  return {
    ...(input.maxTurns === undefined ? {} : { maxTurns: input.maxTurns }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    ...(input.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: input.maxBudgetUsd }),
    ...(fallbackModel === undefined ? {} : { fallbackModel }),
  }
}

export function validateRunOutputOptions(input: {
  readonly interactive?: boolean
  readonly command?: string
  readonly ephemeral?: boolean
  readonly session?: string
  readonly continue?: boolean
  readonly fork?: boolean
  readonly inputID?: string
  readonly outputSchema?: string
  readonly outputLastMessage?: string
  readonly model?: string
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly maxBudgetUsd?: number
  readonly fallbackModel?: string
}) {
  if (input.interactive) {
    if (input.outputSchema !== undefined) throw new Error("--output-schema cannot be used in interactive mode")
    if (input.outputLastMessage !== undefined)
      throw new Error("--output-last-message cannot be used in interactive mode")
    if (input.ephemeral) throw new Error("--ephemeral cannot be used in interactive mode")
  }
  if (input.outputSchema !== undefined && input.command !== undefined)
    throw new Error("--output-schema cannot be used with --command")
  if (input.ephemeral && (input.session !== undefined || input.continue || input.fork || input.inputID !== undefined))
    throw new Error("--ephemeral cannot be used with --session, --continue, --fork, or --input-id")
  parseRunGuardrails(input)
}

export async function loadOutputSchema(filePath: string, baseDir: string): Promise<LoadedOutputSchema> {
  if (!filePath.trim()) throw new Error("--output-schema requires a non-empty file path")
  const file = Bun.file(path.resolve(baseDir, filePath))
  if (!(await file.exists())) throw new Error(`Output schema file not found: ${filePath}`)
  const parsedJson = decodeJson(await file.text())
  if (Option.isNone(parsedJson)) throw new Error(`Output schema file is not valid JSON: ${filePath}`)
  const record = decodeRecord(parsedJson.value)
  if (Option.isNone(record) || Array.isArray(parsedJson.value))
    throw new Error(`Output schema must be a JSON object: ${filePath}`)
  const schema = { ...record.value }
  const codec = await Tool.jsonSchema(schema as JsonSchema.JsonSchema).catch((error) => {
    throw new Error(`Invalid JSON Schema in ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  })
  const decode = Schema.decodeUnknownOption(codec)
  return {
    rawText: JSON.stringify(schema, null, 2),
    schema,
    validate: (value) => {
      const checked = decode(value)
      return Option.isSome(checked)
        ? { ok: true, value: checked.value }
        : { ok: false, message: `Final output did not conform to JSON Schema (${filePath})` }
    },
  }
}

export function appendOutputSchemaPrompt(prompt: string, rawSchemaText: string): string {
  const instruction = [
    "<output_schema_contract>",
    "Your final response MUST be ONLY a valid JSON value that conforms strictly to the following JSON Schema.",
    "Do not wrap the JSON in markdown code fences and do not include any explanatory prose before or after the JSON.",
    rawSchemaText,
    "</output_schema_contract>",
  ].join("\n")
  return prompt.trim() ? `${prompt}\n\n${instruction}` : instruction
}

export function parseStructuredText(rawText: string, spec: LoadedOutputSchema): ValidationResult {
  const trimmed = rawText.trim()
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  const candidate = fenced ? fenced[1]!.trim() : trimmed
  if (!candidate) return { ok: false, message: "Model produced empty output instead of JSON matching --output-schema" }
  const parsed = decodeJson(candidate)
  if (Option.isNone(parsed))
    return { ok: false, message: "Final assistant output is not valid JSON matching --output-schema" }
  return spec.validate(parsed.value)
}

export async function writeLastMessage(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await Bun.write(targetPath, content)
}
