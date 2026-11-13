import type { ApexoClient } from "./gen/sdk.gen.js"
import type {
  McpElicitationContent,
  McpElicitationRequest,
  McpElicitationField,
  McpElicitationValue,
} from "./gen/types.gen.js"

export type McpElicitationApi = ApexoClient["v2"]["mcpElicitation"]

export function elicitationDefaults(request: McpElicitationRequest): McpElicitationContent {
  return Object.fromEntries(
    request.form.fields.flatMap((field) => {
      if (field.default !== undefined)
        return [[field.name, typeof field.default === "object" ? [...field.default] : field.default]]
      if (field.type === "boolean") return [[field.name, false]]
      if (field.type === "multi") return [[field.name, []]]
      if (field.type === "string" && field.required) return [[field.name, ""]]
      return []
    }),
  )
}

/** Numeric editor drafts stay strings until an explicit submit; defaults never submit themselves. */
export function elicitationContent(
  request: McpElicitationRequest,
  drafts: McpElicitationContent,
): { content: McpElicitationContent; invalid?: undefined } | { invalid: string; content?: undefined } {
  const content: McpElicitationContent = {}
  for (const field of request.form.fields) {
    const value = drafts[field.name]
    if (
      value === undefined ||
      (value === "" &&
        (field.type === "number" || field.type === "integer" || (field.type === "string" && !field.required)))
    )
      continue
    if (field.type === "multi" && !field.required && Array.isArray(value) && value.length === 0) continue
    if (field.type === "number" || field.type === "integer") {
      if (typeof value === "number") {
        content[field.name] = value
        continue
      }
      if (
        typeof value !== "string" ||
        !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ||
        !Number.isFinite(Number(value))
      )
        return { invalid: field.name }
      content[field.name] = Number(value)
      continue
    }
    content[field.name] = value
  }
  return { content }
}

export function elicitationError(error: unknown): { field?: string } {
  if (error && typeof error === "object" && "field" in error && typeof error.field === "string")
    return { field: error.field }
  return {}
}

/** Authoritative live-state hydration shared by the three Solid surfaces, including reconnects. */
export function watchMcpElicitations(
  api: McpElicitationApi,
  sessions: () => readonly string[],
  update: (requests: McpElicitationRequest[]) => void,
) {
  const state = {
    closed: false,
    pending: false,
    key: "",
    unsupported: "",
    abort: undefined as AbortController | undefined,
    requests: [] as McpElicitationRequest[],
  }
  const refresh = async () => {
    const ids = [...new Set(sessions().filter(Boolean))]
    const key = JSON.stringify(ids)
    if (state.closed || (state.pending && state.key === key) || state.unsupported === key) return
    state.abort?.abort()
    if (state.key !== key) {
      state.requests = state.requests.filter((request) => ids.includes(request.sessionID))
      update(state.requests)
    }
    const abort = new AbortController()
    state.abort = abort
    state.key = key
    state.pending = true
    const results = await Promise.allSettled(
      ids.map((sessionID) =>
        api.list(
          { sessionID },
          { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]), throwOnError: false },
        ),
      ),
    )
    if (state.closed || abort.signal.aborted) return
    if (JSON.stringify([...new Set(sessions().filter(Boolean))]) !== key) {
      state.pending = false
      void refresh()
      return
    }
    if (
      results.length &&
      results.every((result) => result.status === "fulfilled" && [404, 405].includes(result.value.response.status))
    )
      state.unsupported = key
    const items = results.flatMap((result, index) =>
      result.status === "fulfilled" && result.value.response.ok && result.value.data
        ? result.value.data.filter((request) => request.sessionID === ids[index])
        : state.requests.filter(
            (request) =>
              request.sessionID === ids[index] &&
              !(result.status === "fulfilled" && [404, 405].includes(result.value.response.status)),
          ),
    )
    state.requests = items.map((item) => state.requests.find((old) => old.id === item.id) ?? item)
    state.pending = false
    update(state.requests)
  }
  const timer = setInterval(() => void refresh(), 1500)
  void refresh()
  return {
    refresh,
    close() {
      state.closed = true
      clearInterval(timer)
      state.abort?.abort()
    },
  }
}

export function selectedValues(value: McpElicitationValue | undefined) {
  return Array.isArray(value) ? value : []
}

export function elicitationConstraints(field: McpElicitationField) {
  if (field.type === "string")
    return [
      ...(field.minLength === undefined ? [] : [{ kind: "minLength" as const, value: field.minLength }]),
      ...(field.maxLength === undefined ? [] : [{ kind: "maxLength" as const, value: field.maxLength }]),
      ...(field.format === undefined ? [] : [{ kind: "format" as const, value: field.format }]),
    ]
  if (field.type === "number" || field.type === "integer")
    return [
      ...(field.type === "integer" ? [{ kind: "integer" as const, value: "" }] : []),
      ...(field.minimum === undefined ? [] : [{ kind: "minimum" as const, value: field.minimum }]),
      ...(field.maximum === undefined ? [] : [{ kind: "maximum" as const, value: field.maximum }]),
    ]
  if (field.type === "multi")
    return [
      ...(field.minItems === undefined ? [] : [{ kind: "minItems" as const, value: field.minItems }]),
      ...(field.maxItems === undefined ? [] : [{ kind: "maxItems" as const, value: field.maxItems }]),
    ]
  return []
}
