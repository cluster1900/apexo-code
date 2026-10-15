export * as McpResources from "./mcp-resources"

import type { Client } from "@modelcontextprotocol/sdk/client/index.js"

export type Resource = Awaited<ReturnType<Client["listResources"]>>["resources"][number] & { server: string }
export type Template = Awaited<ReturnType<Client["listResourceTemplates"]>>["resourceTemplates"][number] & {
  server: string
}
export type Read = Awaited<ReturnType<Client["readResource"]>>
export type CatalogError = { server: string; code: string; message: string }
export type Catalog = { resources: Resource[]; errors: CatalogError[] }
export type Templates = { resourceTemplates: Template[]; errors: CatalogError[] }
export class Invalid extends Error {}
export const MAX_ITEMS = 1_000
export const MAX_CATALOG_BYTES = 1024 * 1024
export const MAX_CONTENT_BYTES = 10 * 1024 * 1024

/** Keep whole-server permission grants literal; resource URIs stay opaque. */
export const permissionResource = (server: string, uri = "*") =>
  `mcp:${server.replaceAll("%", "%25").replaceAll(":", "%3A").replaceAll("*", "%2A").replaceAll("?", "%3F").replaceAll("\\", "%5C")}:${uri}`

export async function catalog(
  client: Client,
  kind: "resources",
  timeout: number,
  signal: AbortSignal,
): Promise<Omit<Resource, "server">[]>
export async function catalog(
  client: Client,
  kind: "templates",
  timeout: number,
  signal: AbortSignal,
): Promise<Omit<Template, "server">[]>
export async function catalog(
  client: Client,
  kind: "resources" | "templates",
  timeout: number,
  signal: AbortSignal,
): Promise<Array<Omit<Resource, "server"> | Omit<Template, "server">>>
export async function catalog(client: Client, kind: "resources" | "templates", timeout: number, signal: AbortSignal) {
  const abort = AbortSignal.any([signal, AbortSignal.timeout(timeout)])
  const items: Array<Omit<Resource, "server"> | Omit<Template, "server">> = []
  const seen = new Set<string>()
  const page = { cursor: undefined as string | undefined, bytes: 0 }
  for (let index = 0; index < MAX_ITEMS; index++) {
    const params = page.cursor === undefined ? undefined : { cursor: page.cursor }
    const options = { signal: abort, timeout, maxTotalTimeout: timeout }
    const result =
      kind === "resources"
        ? await client
            .listResources(params, options)
            .then((page) => ({ entries: page.resources, nextCursor: page.nextCursor }))
        : await client
            .listResourceTemplates(params, options)
            .then((page) => ({ entries: page.resourceTemplates, nextCursor: page.nextCursor }))
    const entries = result.entries
    page.bytes += Buffer.byteLength(JSON.stringify(entries))
    items.push(...entries)
    if (items.length > MAX_ITEMS || page.bytes > MAX_CATALOG_BYTES)
      throw new Invalid("MCP resource catalog exceeds its limit")
    if (result.nextCursor === undefined) return items
    if (seen.has(result.nextCursor)) throw new Invalid("MCP resource catalog repeats a cursor")
    seen.add(result.nextCursor)
    page.cursor = result.nextCursor
  }
  throw new Invalid("MCP resource catalog exceeds its page limit")
}

export async function read(client: Client, uri: string, timeout: number, signal: AbortSignal): Promise<Read> {
  const result = await client.readResource({ uri }, { signal, timeout, maxTotalTimeout: timeout })
  if (!result.contents.length) throw new Invalid("MCP resource returned no contents")
  if (result.contents.length > 128 || Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024)
    throw new Invalid("MCP resource response exceeds its limit")
  const size = result.contents.reduce((bytes, part) => {
    if ("text" in part) return bytes + Buffer.byteLength(part.text)
    const normalized = part.blob.replace(/\s/g, "")
    if (Buffer.from(normalized, "base64").toString("base64") !== normalized)
      throw new Invalid("MCP resource contains invalid base64")
    return bytes + Buffer.from(normalized, "base64").length
  }, 0)
  if (size > MAX_CONTENT_BYTES) throw new Invalid("MCP resource content exceeds its limit")
  return result
}
